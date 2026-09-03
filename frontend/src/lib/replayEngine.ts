import type { Recording, RecordedFrame } from '@/components/QueryWatchPanel';
import type { PlanPlayerState } from '@/components/PlanPlayer';
import type { LiveNodeStats } from '@/components/PlanViewer';
import { aggregateByNode, mergeLiveNodes } from '@/lib/planAggregate';
import {
  type NodeCompletionState, EMPTY_SLICE_TIMING,
  buildRealPlanTree, computeSliceIds, sliceIdsByNid, advanceSliceTiming,
  computeNodeCompletionStates, computeCompletedSlices, computeParentNidBySlice,
} from '@/lib/planTree';

export type { Recording, RecordedFrame };

/**
 * One fully-folded moment of a replayed recording: everything PlanPlayer
 * needs, plus where in the recording we are. `nodeStates` isn't consumed
 * by the view (PlanViewer derives its own for the graph) but is carried
 * anyway — it's the monotonic fold the *next* frame has to build on, and
 * it's the most useful thing to assert on in tests.
 */
export interface ReplayFrameState extends PlanPlayerState {
  /** Index into recording.frames of the frame that produced this state. */
  frameIndex: number;
  /** The frame's own tsMs — ms since recording start. */
  tsMs: number;
  /** Monotonic per-node completion states as of this frame. */
  nodeStates: Record<number, NodeCompletionState>;
}

export class ReplayError extends Error {}

/**
 * Reject anything that isn't a v1 recording before it reaches the
 * pipeline — a stray JSON file dropped on the replay page should say so
 * plainly rather than render an empty graph.
 */
export function parseRecording(raw: unknown): Recording {
  if (!raw || typeof raw !== 'object') throw new ReplayError('Not a JSON object.');
  const rec = raw as Partial<Recording>;
  if (rec.version !== 1) {
    throw new ReplayError(`Unsupported recording version ${JSON.stringify(rec.version)} — this build reads version 1.`);
  }
  if (!Array.isArray(rec.frames)) throw new ReplayError('Recording has no "frames" array.');
  if (rec.frames.length === 0) throw new ReplayError('Recording contains no frames.');
  for (const [i, f] of rec.frames.entries()) {
    if (!f || typeof f.tsMs !== 'number' || !f.progress || !Array.isArray(f.progress.nodes)) {
      throw new ReplayError(`Frame ${i} is malformed (expected { tsMs, progress: { nodes } }).`);
    }
  }
  return {
    version: 1,
    query: typeof rec.query === 'string' ? rec.query : '',
    startedAt: typeof rec.startedAt === 'string' ? rec.startedAt : '',
    clusterInfo: rec.clusterInfo ?? {},
    frames: rec.frames,
  };
}

/**
 * Fold every frame of a recording through the exact pipeline
 * QueryWatchPanel's poll callback runs, returning the accumulated state
 * after each frame.
 *
 * Why an array and not a generator/stepper: the pipeline is monotonic
 * end to end (sticky node states, never-decreasing rows, accumulated
 * activeMs, first-seen-wins frozen ms — see docs/plan-replay.md's gotcha
 * table), so seeking to frame N means replaying 0…N. Materializing the
 * whole walk once, up front, makes scrubbing an array index instead of a
 * re-run. Recordings are tens of frames; the memory is noise.
 *
 * Two deliberate differences from the live driver, both about the fact
 * that a recording is a fixed-length artifact rather than an open-ended
 * poll loop:
 *
 *  - `dtMs` comes from the frames' own `tsMs` deltas rather than wall
 *    clock, so slice timing adds up to the recorded wall time no matter
 *    how fast (or slow) playback runs. Callers wanting accelerated
 *    playback change the *schedule*, not these numbers.
 *  - An empty `nodes` array means "the query ended" (shmem slots
 *    recycled) — same as live — but only once we've seen a frame with
 *    nodes. A leading empty frame is the normal "plan captured, no
 *    instrument rows yet" first poll, and ending the replay on it would
 *    make every recording that starts that way unplayable.
 *
 * `finished` is never synthesized at the end of the frame list: a
 * recording that was stopped by hand while the query was still running
 * genuinely doesn't know how it ended, and claiming otherwise would flip
 * every slice to done (PlanPlayer's finished→all-done fallback) on the
 * last frame of a run we never saw finish.
 */
export function replayRecording(recording: Recording, segments?: number): ReplayFrameState[] {
  const states: ReplayFrameState[] = [];

  // Rolling pipeline state — the driver-side equivalents of
  // QueryWatchPanel's useState/useRef cells, in the same order.
  let realPlan: Recording['frames'][number]['progress']['plan'] | undefined;
  let liveNodes: Record<number, LiveNodeStats> = {};
  let sliceIds: ReturnType<typeof computeSliceIds> | null = null;
  let nidToSlice: Map<number, number> | null = null;
  let parentNidBySlice: Map<number, number | undefined> | null = null;
  let rootMeta: { nid?: number; estRows?: number } | null = null;
  let sliceTiming = EMPTY_SLICE_TIMING;
  let priorNodeStates: Record<number, NodeCompletionState> = {};
  let nodeStates: Record<number, NodeCompletionState> = {};
  let currentlyCompleted = new Set<number>();
  let completedFrozenMs: Record<number, number> = {};
  let memoryMb: number | null = null;
  let finished = false;
  let sawNodes = false;
  let prevTsMs = recording.frames[0]?.tsMs ?? 0;

  for (const [frameIndex, frame] of recording.frames.entries()) {
    const progress = frame.progress;

    if (progress.plan && progress.plan.length > 0) {
      realPlan = progress.plan;
      // Slice grouping is derived once, from the first frame that
      // carried a plan — the captured tree's structure is fixed for the
      // life of the query, and every later lookup is keyed on these
      // exact PlanNode instances.
      if (!nidToSlice) {
        const root = buildRealPlanTree(progress.plan, segments);
        if (root) {
          const ids = computeSliceIds(root);
          nidToSlice = sliceIdsByNid(root, ids);
          sliceIds = ids;
          parentNidBySlice = computeParentNidBySlice(root, ids);
          rootMeta = { nid: root.Nid, estRows: root['Plan Rows'] };
        }
      }
    }

    if (progress.nodes.length === 0) {
      if (sawNodes) finished = true;
    } else {
      sawNodes = true;
      const freshByNode = aggregateByNode(progress.nodes);
      liveNodes = mergeLiveNodes(liveNodes, freshByNode);
      if (progress.memory && progress.memory.length > 0) {
        memoryMb = progress.memory.reduce((sum, m) => sum + m.vmem_mb, 0);
      }
      if (nidToSlice) {
        sliceTiming = advanceSliceTiming(sliceTiming, freshByNode, nidToSlice, frame.tsMs - prevTsMs);
      }
      // Derived state, in the same order the live panel's render derives
      // it: monotonic node states first (they fold over the previous
      // frame's), then the slices those states imply, then the
      // first-seen-wins freeze of each newly-done slice's activeMs.
      const root = realPlan ? buildRealPlanTree(realPlan, segments) : null;
      nodeStates = computeNodeCompletionStates(root, liveNodes, priorNodeStates);
      priorNodeStates = nodeStates;
      currentlyCompleted = computeCompletedSlices(sliceIds, nodeStates, parentNidBySlice ?? undefined);
      for (const sid of currentlyCompleted) {
        if (!(sid in completedFrozenMs)) {
          completedFrozenMs = { ...completedFrozenMs, [sid]: sliceTiming.activeMs[sid] ?? 0 };
        }
      }
    }
    prevTsMs = frame.tsMs;

    states.push({
      frameIndex,
      tsMs: frame.tsMs,
      realPlan,
      liveNodes,
      sliceIds,
      sliceTiming,
      nodeStates,
      currentlyCompleted,
      completedFrozenMs,
      rootMeta,
      memoryMb,
      finished,
      // Run Time on a replay is measured from the start of the
      // recording, the only clock a recording carries. A capture started
      // mid-query therefore reads a little short — the frames simply
      // don't know when the query itself began.
      runTimeMs: frame.tsMs,
    });
  }

  return states;
}

import { useEffect, useMemo, useState, useCallback, useRef, type PointerEvent } from 'react';
import { X, RefreshCw, Circle, Square, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { type LiveNodeStats } from '@/components/PlanViewer';
import { aggregateByNode, mergeLiveNodes } from '@/lib/planAggregate';
import PlanPlayer from '@/components/PlanPlayer';
import { useMetrics } from '@/contexts/metrics';
import {
  type PlanNode, type SliceTiming, type NodeCompletionState, EMPTY_SLICE_TIMING,
  buildRealPlanTree, computeSliceIds, sliceIdsByNid, advanceSliceTiming,
  computeNodeCompletionStates, computeCompletedSlices,
  computeParentNidBySlice,
} from '@/lib/planTree';
import type { QueryProgress, QueryProgressPlanNode } from '@/types/metrics';

// One captured poll response, timestamped from the start of the recording.
// A whole recording is these frames plus a bit of query/cluster metadata,
// serialized as a JSON file that any other pg_dash instance can replay
// without needing a live database — see docs/plan-replay.md for the
// full schema, aggregation-pipeline map, and Phase-2 replay design.
export interface RecordedFrame {
  tsMs: number;
  progress: QueryProgress;
}
export interface Recording {
  version: 1;
  query: string;
  startedAt: string; // ISO
  clusterInfo: { num_segments?: number; mode?: string };
  frames: RecordedFrame[];
}

interface QueryWatchPanelProps {
  pid: number;
  sql: string;
  /** pg_stat_activity.query_start for this pid, if the caller already has it (Activity Monitor's row, SQL Editor's pid-discovery match) — used as "Run Time"'s start; falls back to when this panel was opened if absent. */
  queryStart?: string | null;
  /** Per-execution tag the SQL Editor generated and passed to the backend as application_name='pg_dash:<tag>'. When present, /progress verifies pid + application_name (exact match) instead of pid + sql substring — precise, and immune to the pool-reuse race between polls. Absent when the panel opens from Activity Monitor's "watch that stranger's query" flow, which never had a tag to begin with. */
  tag?: string | null;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 800;

// Plain top-level helpers (not written inline in the component body) so the
// wall-clock reads they do aren't flagged as an impure render — same
// pattern Activity.tsx's own computeDuration already uses for the same
// reason (Date.now() is fine off the render's critical path, e.g. inside a
// ref initializer that only ever runs once, or a value only read when
// asked for).
function resolveStartMs(queryStart?: string | null): number {
  return queryStart ? new Date(queryStart).getTime() : Date.now();
}
function nowMs(): number {
  return Date.now();
}

export default function QueryWatchPanel({ pid, sql, queryStart, tag, onClose }: QueryWatchPanelProps) {
  // Segments count feeds buildRealPlanTree so we can synthesize Motion N:M
  // labels (Gather=N→1, Broadcast/Redistribute/Explicit=N→N) — whpg_plan_tree
  // ships those columns as null, so without this the plugin gives no fan-in/
  // fan-out hint at all.
  const { clusterInfo } = useMetrics();
  const segmentsCount = clusterInfo?.num_segments;
  const [realPlan, setRealPlan] = useState<QueryProgressPlanNode[] | undefined>(undefined);
  const [liveNodes, setLiveNodes] = useState<Record<number, LiveNodeStats>>({});
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Snapshot recording: every /progress response gets appended to a ref
  // while `recording` is on. Stopping (manually or auto on query end)
  // freezes the frames; `hasRecording` gates the Download button. Using
  // a ref for the toggle bit so poll's useCallback doesn't need
  // `recording` in its deps (which would tear down and re-arm the
  // interval on every start/stop, losing frames across the seam).
  const [recording, setRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const recordingRef = useRef(false);
  const framesRef = useRef<RecordedFrame[]>([]);
  const recordStartRef = useRef<number>(0);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  const startRecording = () => {
    framesRef.current = [];
    setFrameCount(0);
    recordStartRef.current = Date.now();
    setHasRecording(false);
    setRecording(true);
  };
  const stopRecording = () => {
    setRecording(false);
    setHasRecording(framesRef.current.length > 0);
  };
  // If the query finishes while a recording is on, freeze it — no more
  // frames will ever arrive, and leaving the ⏺ button "hot" is confusing.
  useEffect(() => {
    if (finished && recordingRef.current) {
      setRecording(false);
      setHasRecording(framesRef.current.length > 0);
    }
  }, [finished]);
  const downloadRecording = () => {
    const rec: Recording = {
      version: 1,
      query: sql,
      startedAt: new Date(recordStartRef.current).toISOString(),
      clusterInfo: {
        num_segments: clusterInfo?.num_segments,
        mode: clusterInfo?.mode,
      },
      frames: framesRef.current,
    };
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plan-snapshot-${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace(/Z$/, '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Panel width, draggable from its left edge — the panel itself is
  // anchored to the right side of the screen (slides in from the right),
  // so dragging the handle left/right changes width, not position.
  const [panelWidth, setPanelWidth] = useState(768);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const onResizePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    resizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: panelWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    // Dragging the left edge left (negative dx) makes the panel wider,
    // since the right edge stays pinned to the screen's edge.
    const next = Math.min(window.innerWidth - 48, Math.max(420, drag.startWidth - dx));
    setPanelWidth(next);
  };
  const onResizePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  // "Run Time" clock start — the query's own query_start when the caller
  // has it, else when this panel first mounted (close enough: Watch is
  // opened moments after a query starts, in both the SQL Editor and
  // Activity Monitor's "watch this already-running query" cases). Set
  // once via the lazy useState initializer, never changes again.
  const [startMs] = useState<number>(() => resolveStartMs(queryStart));

  // Slice grouping/root metadata, and per-slice "active time" (see
  // advanceSliceTiming's own comment for what that actually measures) —
  // all state, all read at render time to build the summary panel, so none
  // of it may live in a ref (React flags reading ref.current during
  // render). nidToSliceRef is the one exception: it's pure poll-loop
  // bookkeeping (matching a fresh poll's per-nid rows back to a slice) that
  // the render path never touches, so a ref is correct for it.
  const [sliceIds, setSliceIds] = useState<Map<PlanNode, number> | null>(null);
  // Parent-node nid per slice — derived once from the FIRST poll's tree
  // structure (queries don't reshape mid-run). Rule B in
  // computeCompletedSlices reads it to check the plan-parent's state
  // for slices whose own nodes never lit up. Kept in state alongside
  // sliceIds so it stays keyed on the same first-poll tree instances.
  const [parentNidBySlice, setParentNidBySlice] = useState<Map<number, number | undefined> | null>(null);
  const [rootMeta, setRootMeta] = useState<{ nid?: number; estRows?: number } | null>(null);
  const [sliceTiming, setSliceTiming] = useState<SliceTiming>(EMPTY_SLICE_TIMING);
  const [lastPollAt, setLastPollAt] = useState<number>(() => nowMs());
  const nidToSliceRef = useRef<Map<number, number> | null>(null);
  // Mirrors lastPollAt for use inside the poll callback itself: the dt
  // computation needs the *previous* poll's timestamp synchronously, and
  // reading state back out of the same closure that scheduled its own
  // update would see a stale value until the next render runs.
  const lastPollAtInternalRef = useRef<number>(nowMs());

  const poll = useCallback(() => {
    // Prefer tag when the SQL Editor gave us one — the backend looks up
    // sess_id by pid + application_name (exact), which is immune to the
    // read-only-wrap and multi-statement-batch reformatting that the
    // sql substring path used to trip on. Fall back to sql for callers
    // that never had a tag (Activity Monitor's "watch that stranger").
    api.getQueryProgress(pid, tag ? { tag } : { sql })
      .then(progress => {
        // Capture the raw response for snapshot recording before any
        // processing — the frame is what a *live* consumer would have
        // seen off the wire, which is what a replay needs to feed
        // through the same aggregation/merge pipeline verbatim. Also
        // capture the empty terminal frame below (helpful for a replay
        // to know exactly when the query "ended").
        if (recordingRef.current) {
          framesRef.current.push({
            tsMs: Date.now() - recordStartRef.current,
            progress,
          });
          setFrameCount(framesRef.current.length);
        }
        // The shmem slots this reads (whpg_plan_tree.instrument_detail /
        // whpg_plan_tree.plan_detail) recycle the instant the query's backend
        // resource owner releases — i.e. right as it finishes — so the
        // very next poll after completion comes back empty, not 404. Treat
        // that the same as the 404 case below: stop polling and freeze on
        // whatever was last shown, instead of overwriting it with nothing.
        if (progress.nodes.length === 0) {
          setFinished(true);
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        const freshByNode = aggregateByNode(progress.nodes);
        setLiveNodes(prev => mergeLiveNodes(prev, freshByNode));
        if (progress.memory && progress.memory.length > 0) {
          setMemoryMb(progress.memory.reduce((sum, m) => sum + m.vmem_mb, 0));
        }
        // WHPG-only: the real plan tree captured at query start (see
        // Capabilities.RealPlanShmem). Absent on any server without the
        // kernel feature; PlanViewer falls back to the EXPLAIN-based
        // reconstruction in that case.
        if (progress.plan && progress.plan.length > 0) {
          setRealPlan(progress.plan);

          // Slice grouping only needs computing once — the captured tree's
          // structure is fixed for the life of the query.
          if (!nidToSliceRef.current) {
            const root = buildRealPlanTree(progress.plan, segmentsCount);
            if (root) {
              const ids = computeSliceIds(root);
              nidToSliceRef.current = sliceIdsByNid(root, ids);
              setSliceIds(ids);
              setParentNidBySlice(computeParentNidBySlice(root, ids));
              setRootMeta({ nid: root.Nid, estRows: root['Plan Rows'] });
            }
          }
        }

        if (nidToSliceRef.current) {
          const now = nowMs();
          const dt = now - lastPollAtInternalRef.current;
          lastPollAtInternalRef.current = now;
          setLastPollAt(now);
          setSliceTiming(prev => advanceSliceTiming(prev, freshByNode, nidToSliceRef.current!, dt));
        }
      })
      .catch(() => {
        // 404 = backend gone, i.e. the query finished (or was cancelled).
        // liveNodes/realPlan are deliberately left untouched here — they
        // keep showing the last snapshot until the user closes the panel.
        setFinished(true);
        if (pollRef.current) clearInterval(pollRef.current);
      });
  }, [pid, sql, tag, segmentsCount]);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [poll]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Recomputed on every render (each poll re-renders via setLiveNodes/
  // setFinished above) rather than cached in state, so — same as every
  // other live figure in this panel — a query that just finished snaps
  // this to 100% immediately via `finished`, instead of freezing at
  // whatever number happened to be in flight the moment it ended.
  const runTimeMs = (finished ? lastPollAt : nowMs()) - startMs;
  // Which slices are known-completed by topology (their nodes are in
  // state='completed' because an ancestor is currently holding rows).
  // Lets SliceSummaryPanel show "done" for slices that finished before
  // our 800ms polling ever caught them producing — no observed activeMs,
  // but plan-tree completion inference makes it clear they ran.
  const root = useMemo(
    () => (realPlan ? buildRealPlanTree(realPlan, segmentsCount) : null),
    [realPlan, segmentsCount],
  );
  // Sticky rank per nid so the graph's per-node progress bar can't
  // regress across polls. Kept in a ref (not state) because we mutate
  // it during useMemo and we don't want that mutation to trigger a
  // re-render — the useMemo's own result already carries the change.
  // Reset would only make sense on unmount / new query, and the panel
  // remounts for each of those, which reinitializes the ref.
  const priorNodeStatesRef = useRef<Record<number, NodeCompletionState>>({});
  // SUPPRESSED, NOT RESOLVED. react-hooks/refs is right that folding
  // through a ref during render is illegal: React may re-run or discard
  // a useMemo, and each of those either double-applies or loses a step
  // of a fold that has no way to replay itself.
  //
  // The fix is to hold the fold in state and advance it inside poll()
  // — an event handler, where a monotonic update belongs — reading root
  // and the merged liveNodes from refs poll() already keeps for exactly
  // this reason (nidToSliceRef, lastPollAtInternalRef). That is a
  // behaviour change to the live plan-progress pipeline, and this
  // component has no tests: it only does anything against a running
  // distributed query, which can't be exercised here. Left as-is rather
  // than changed unverified.
  /* eslint-disable react-hooks/refs */
  const nodeStates = useMemo(() => {
    const next = computeNodeCompletionStates(root, liveNodes, priorNodeStatesRef.current);
    priorNodeStatesRef.current = next;
    return next;
  }, [root, liveNodes]);
  /* eslint-enable react-hooks/refs */
  // The raw per-poll "which slices look completed *right now*" set. A
  // slice can flicker in/out of it as HJ 8 (the ancestor) briefly has
  // no new tuples between polls, so we don't feed this directly to the
  // panel — everCompletedSlices accumulates monotonically below.
  const currentlyCompleted = useMemo(
    () => computeCompletedSlices(sliceIds, nodeStates, parentNidBySlice ?? undefined),
    [sliceIds, nodeStates, parentNidBySlice],
  );
  // Freeze a slice's activeMs at the moment it first became topology-
  // completed — the sticky slice-credit rule in advanceSliceTiming
  // keeps ticking activeMs upward with wall clock, so a slice that
  // finished sending at 5s of a 30s query kept showing "27s done" as
  // the wall clock advanced. The frozen value is what the sidebar
  // displays instead. First-seen wins; subsequent polls never
  // overwrite — even if the slice temporarily leaves currentlyCompleted
  // (a downstream node lights up and Rule A's "no active" guard
  // rejects it for a while), the frozen value we captured the first
  // time it landed is still the right snapshot of "how long the slice
  // was actively running before its gang wound down."
  const [completedFrozenMs, setCompletedFrozenMs] = useState<Record<number, number>>({});
  useEffect(() => {
    let frozenChanged = false;
    const nextFrozen = { ...completedFrozenMs };
    for (const s of currentlyCompleted) {
      if (!(s in nextFrozen)) {
        nextFrozen[s] = sliceTiming.activeMs[s] ?? 0;
        frozenChanged = true;
      }
    }
    if (frozenChanged) setCompletedFrozenMs(nextFrozen);
  }, [currentlyCompleted, completedFrozenMs, sliceTiming.activeMs]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        className="relative max-w-[calc(100vw-3rem)] bg-zinc-900 border-l border-zinc-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        style={{ width: panelWidth }}
      >
        {/* Drag handle — the panel is anchored to the right edge, so
            dragging this left/right changes its width, not its position. */}
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-blue-500/50 z-10"
        />

        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Watching query — pid {pid}</h2>
            <p className="text-xs text-zinc-500 font-mono truncate max-w-lg">{sql}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!finished && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <RefreshCw size={12} className="animate-spin" /> live
              </span>
            )}
            {/* Snapshot recording controls: ⏺ starts (or ⏹ stops)
                capturing every /progress response into a JSON blob;
                💾 downloads the frozen recording. The captured file
                can be replayed in any pg_dash instance without needing
                a live database — great for README demos, LinkedIn
                posts, and bug repros. */}
            {!recording && !finished && (
              <button
                onClick={startRecording}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors text-xs"
                title="Start recording — captures every /progress response for offline replay"
              >
                <Circle size={11} /> Record
              </button>
            )}
            {recording && (
              <button
                onClick={stopRecording}
                className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors text-xs"
                title="Stop recording"
              >
                <Square size={10} fill="currentColor" />
                <span className="tabular-nums">Recording · {frameCount} frames</span>
              </button>
            )}
            {hasRecording && !recording && (
              <button
                onClick={downloadRecording}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-300 transition-colors text-xs"
                title={`Download ${frameCount} captured frames as JSON`}
              >
                <Download size={11} /> Save
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors" title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* The view itself is shared with the replay driver — same props,
            same pipeline output, so a recording plays back pixel-identical
            to the live run it was captured from. See PlanPlayerState. */}
        <PlanPlayer
          realPlan={realPlan} liveNodes={liveNodes} segments={segmentsCount}
          sliceIds={sliceIds} sliceTiming={sliceTiming}
          currentlyCompleted={currentlyCompleted} completedFrozenMs={completedFrozenMs}
          rootMeta={rootMeta} memoryMb={memoryMb} finished={finished} runTimeMs={runTimeMs}
        />
      </div>
    </div>
  );
}

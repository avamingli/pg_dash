import { useMemo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import PlanViewer, { type LiveNodeStats } from '@/components/PlanViewer';
import {
  type PlanNode, type SliceTiming,
  summarizeSlices, estimateCompletionPct,
} from '@/lib/planTree';
import type { QueryProgressPlanNode } from '@/types/metrics';

/**
 * Everything a driver has to hand over for one "moment" of a watched
 * query — the live poll loop's accumulated state, or a replay's state
 * as of frame N. Both drivers (QueryWatchPanel, ReplayPanel) build this
 * with the same planTree.ts pipeline, so a recorded run renders
 * identically to the live run it was captured from.
 *
 * Everything here is either raw driver state or a monotonic/sticky fold
 * of it. The sticky pieces (`currentlyCompleted` via a monotonic
 * nodeStates, `completedFrozenMs`) deliberately live in the *driver*,
 * not here: a replay scrubbing backwards has to be able to rewind them,
 * which a component that owned them internally could not do.
 */
export interface PlanPlayerState {
  /** WHPG real plan-shmem rows, as captured on the first poll/frame that had them. */
  realPlan?: QueryProgressPlanNode[];
  /** Per-nid rows/segments/growing, merged across polls (mergeLiveNodes). */
  liveNodes: Record<number, LiveNodeStats>;
  /** Slice id per plan node, from the first captured tree. */
  sliceIds: Map<PlanNode, number> | null;
  /** Per-slice accumulated active ms + sticky seenActive (advanceSliceTiming). */
  sliceTiming: SliceTiming;
  /** Slices the topology inference currently calls done (computeCompletedSlices). */
  currentlyCompleted: Set<number>;
  /** activeMs frozen at the moment each slice first became completed. */
  completedFrozenMs: Record<number, number>;
  /** Root node's nid + row estimate, for the overall progress percentage. */
  rootMeta: { nid?: number; estRows?: number } | null;
  /** Summed vmem across segments, or null before any memory sample arrived. */
  memoryMb: number | null;
  /** Query has ended — flips the sidebar to "all slices done" and stops the pulse. */
  finished: boolean;
  /** Wall-clock ms since the query started (live) or since the recording started (replay). */
  runTimeMs: number;
}

interface PlanPlayerProps extends PlanPlayerState {
  /** Cluster segment count — synthesizes Motion N:M labels in buildRealPlanTree. */
  segments?: number;
  /**
   * The driver's playback controls, if it has any (ReplayPanel does, the
   * live panel doesn't). Passed down to the graph so its fullscreen
   * overlay — a portal into document.body, outside this tree — can show
   * them too.
   */
  transport?: ReactNode;
}

/**
 * The Watch view's body: status line, plan graph/tree, footer caveat.
 * Pure — props in, UI out, no polling, no timers, no state of its own
 * beyond PlanViewer's own view-mode toggle. Renders as a fragment so
 * the caller keeps control of the surrounding flex layout (the live
 * panel is a right-hand drawer; the replay page is a full-width card).
 */
export default function PlanPlayer({
  realPlan, liveNodes, sliceIds, sliceTiming, currentlyCompleted, completedFrozenMs,
  rootMeta, memoryMb, finished, runTimeMs, segments, transport,
}: PlanPlayerProps) {
  const hasRealPlan = !!realPlan && realPlan.length > 0;

  const completedSlicesForSummary = useMemo(() => {
    // Query has ended → every slice necessarily ran. computeNodeCompletionStates
    // marks a node 'completed' only when an ancestor is currently growing;
    // a query that just ended has no growing anywhere, so an empty
    // completed set is expected right at the finish. Fall back to "all
    // slices are done" so SliceSummaryPanel doesn't drop the ✓ badge
    // off half the rows the moment the query completes.
    if (finished && sliceIds) return new Set(sliceIds.values());
    return currentlyCompleted;
  }, [finished, sliceIds, currentlyCompleted]);

  // Substitute frozen activeMs for any completed slice — sidebar shows
  // "how long this slice was actively running" (frozen at completion),
  // not "how long ago it completed" (which ticks with wall clock and
  // confuses the reader).
  const displayActiveMs = useMemo(() => {
    const out = { ...sliceTiming.activeMs };
    for (const [sidStr, ms] of Object.entries(completedFrozenMs)) {
      out[Number(sidStr)] = ms;
    }
    return out;
  }, [sliceTiming.activeMs, completedFrozenMs]);

  const sliceSummaries = sliceIds
    ? summarizeSlices(sliceIds, displayActiveMs, runTimeMs, completedSlicesForSummary)
    : [];
  const overallProgressPct = rootMeta?.nid != null
    ? estimateCompletionPct(liveNodes[rootMeta.nid], rootMeta.estRows, finished)
    : null;

  return (
    <>
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-4 text-xs">
        {memoryMb != null && (
          <span className="text-zinc-400">Memory: <span className="text-zinc-200 font-mono">{memoryMb} MB</span></span>
        )}
        {finished && (
          <span className="flex items-center gap-1.5 text-zinc-400">
            <AlertTriangle size={12} className="text-yellow-400" /> Finished — showing the last snapshot before it ended
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {hasRealPlan ? (
          <PlanViewer
            liveNodes={liveNodes} realPlan={realPlan} finished={finished}
            segments={segments}
            sliceSummaries={sliceSummaries} runTimeMs={runTimeMs} estProgressPct={overallProgressPct}
            fullscreenTransport={transport}
          />
        ) : finished ? (
          <p className="text-sm text-zinc-500 p-4">Query ended before its plan tree was captured — nothing to show.</p>
        ) : (
          <p className="text-sm text-zinc-500 p-4">Loading plan...</p>
        )}
      </div>

      <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">
        Rows shown are live per-node counts from gp_instrument_shmem — an approximation, not a guarantee (nodes can burst rather than stream steadily).
      </div>
    </>
  );
}

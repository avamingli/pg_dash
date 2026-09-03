import type { LiveNodeStats } from '@/components/PlanViewer';
import type { QueryProgressNode } from '@/types/metrics';

// Per-poll aggregation, shared by the two drivers of the Watch view:
// QueryWatchPanel (live /progress polls) and ReplayPanel (recorded
// frames replayed through the same pipeline). Lived in
// QueryWatchPanel.tsx until the replay driver needed it too — a
// component file can't export non-components without breaking Fast
// Refresh, so both helpers moved here verbatim. The rest of the
// pipeline (advanceSliceTiming, computeNodeCompletionStates,
// computeCompletedSlices) is in planTree.ts.

export function aggregateByNode(nodes: QueryProgressNode[]): Record<number, LiveNodeStats> {
  const byNode: Record<number, { rows: number; segments: Set<number> }> = {};
  for (const n of nodes) {
    // ntuples only accumulates once a scan *cycle* completes (InstrEndLoop) —
    // a plain single-pass node (e.g. a driving outer Seq Scan that never
    // rescans) stays at ntuples=0 for its entire run and only shows up in
    // tuplecount (the current, still in-progress cycle's count). Rescanned
    // nodes like Materialize roll most of their total into ntuples quickly,
    // so summing both is correct for either case without needing to know
    // which kind of node this is.
    //
    // Keep zero-row entries. A shmem row of {segid=-1, rows=0} left behind
    // by a finished leaf's recycled slot still carries "this node exists in
    // the running query"; dropping it here removed the whole dim-table
    // subtree from liveNodes, which killed edge animation and slice-timing
    // credit for those slices even though their gang processes were still
    // alive. estimateCompletionPct handles the 0-rows case by returning
    // null (renders as "—"), not by pretending it's 0% complete — so we
    // don't have to lie at the aggregation layer to avoid a misleading %.
    const entry = byNode[n.nid] ?? (byNode[n.nid] = { rows: 0, segments: new Set() });
    entry.rows += n.ntuples + n.tuplecount;
    entry.segments.add(n.segid);
  }
  const result: Record<number, LiveNodeStats> = {};
  for (const [nid, v] of Object.entries(byNode)) {
    // growing is filled in during mergeLiveNodes, where we have the prior
    // poll's rows to compare against; a fresh aggregate on its own doesn't
    // know whether this is "N rows and rising" or "N rows and stopped".
    result[Number(nid)] = { rows: v.rows, segments: v.segments.size, growing: false };
  }
  return result;
}

// whpg_plan_tree.instrument_detail's row for a plan node vanishes the instant that
// node's slot recycles — normal for a node that finishes well before the
// whole query does (e.g. a Seq Scan feeding a Hash Join that's still
// building its table). Blindly replacing liveNodes with whatever the latest
// poll returns read as that node's progress reverting to 0 the moment it
// actually finished. Merge instead: a nid missing from the latest poll keeps
// its last known stats, and a nid present in both never goes backwards.
//
// Also computes each surviving nid's `growing` bit — did rows increase on
// THIS merge vs the last one? computeNodeCompletionStates uses this to tell
// a still-producing node ("Hash Join probing") from a plateau'd one ("Hash
// finished building, waiting to be probed") — they both have rows > 0, so
// only the growth signal distinguishes them.
export function mergeLiveNodes(
  prev: Record<number, LiveNodeStats>,
  next: Record<number, LiveNodeStats>,
): Record<number, LiveNodeStats> {
  const merged: Record<number, LiveNodeStats> = {};
  // Start by copying prev, but clear each entry's growing bit — nids not
  // present in `next` this poll definitionally aren't growing this poll.
  for (const [key, stats] of Object.entries(prev)) {
    merged[Number(key)] = { ...stats, growing: false };
  }
  for (const [key, stats] of Object.entries(next)) {
    const nid = Number(key);
    const existing = prev[nid];
    if (existing) {
      merged[nid] = {
        rows: Math.max(existing.rows, stats.rows),
        segments: Math.max(existing.segments, stats.segments),
        growing: stats.rows > existing.rows,
      };
    } else {
      // First time we see this nid: treat any non-zero rows as growth
      // (there was nothing before, so the delta from "not seen" to "here"
      // is real activity), and a 0-row placeholder appearance as idle.
      merged[nid] = { ...stats, growing: stats.rows > 0 };
    }
  }
  return merged;
}

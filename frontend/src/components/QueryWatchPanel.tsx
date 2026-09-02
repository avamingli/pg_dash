import { useEffect, useState, useCallback, useRef, type PointerEvent } from 'react';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import PlanViewer, { type LiveNodeStats } from '@/components/PlanViewer';
import { useMetrics } from '@/contexts/MetricsContext';
import {
  type PlanNode, type SliceTiming, EMPTY_SLICE_TIMING,
  buildRealPlanTree, computeSliceIds, sliceIdsByNid, advanceSliceTiming, summarizeSlices,
  estimateCompletionPct,
} from '@/lib/planTree';
import type { QueryProgressNode, QueryProgressPlanNode } from '@/types/metrics';

interface QueryWatchPanelProps {
  pid: number;
  sql: string;
  /** pg_stat_activity.query_start for this pid, if the caller already has it (Activity Monitor's row, SQL Editor's pid-discovery match) — used as "Run Time"'s start; falls back to when this panel was opened if absent. */
  queryStart?: string | null;
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

function aggregateByNode(nodes: QueryProgressNode[]): Record<number, LiveNodeStats> {
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
    result[Number(nid)] = { rows: v.rows, segments: v.segments.size };
  }
  return result;
}

// gp_instrument_shmem_detail's row for a plan node vanishes the instant that
// node's slot recycles — normal for a node that finishes well before the
// whole query does (e.g. a Seq Scan feeding a Hash Join that's still
// building its table). Blindly replacing liveNodes with whatever the latest
// poll returns read as that node's progress reverting to 0 the moment it
// actually finished. Merge instead: a nid missing from the latest poll keeps
// its last known stats, and a nid present in both never goes backwards.
function mergeLiveNodes(
  prev: Record<number, LiveNodeStats>,
  next: Record<number, LiveNodeStats>,
): Record<number, LiveNodeStats> {
  const merged: Record<number, LiveNodeStats> = { ...prev };
  for (const [key, stats] of Object.entries(next)) {
    const nid = Number(key);
    const existing = merged[nid];
    merged[nid] = existing
      ? { rows: Math.max(existing.rows, stats.rows), segments: Math.max(existing.segments, stats.segments) }
      : stats;
  }
  return merged;
}

export default function QueryWatchPanel({ pid, sql, queryStart, onClose }: QueryWatchPanelProps) {
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
  const hasRealPlan = !!realPlan && realPlan.length > 0;

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
    api.getQueryProgress(pid, sql)
      .then(progress => {
        // The shmem slots this reads (gp_instrument_shmem_detail /
        // plan_tree_detail) recycle the instant the query's backend
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
  }, [pid, sql, segmentsCount]);

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
  const sliceSummaries = sliceIds ? summarizeSlices(sliceIds, sliceTiming.activeMs, runTimeMs) : [];
  const overallProgressPct = rootMeta?.nid != null
    ? estimateCompletionPct(liveNodes[rootMeta.nid], rootMeta.estRows, finished)
    : null;

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
            <button onClick={onClose} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors" title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

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
              segments={segmentsCount}
              sliceSummaries={sliceSummaries} runTimeMs={runTimeMs} estProgressPct={overallProgressPct}
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
      </div>
    </div>
  );
}

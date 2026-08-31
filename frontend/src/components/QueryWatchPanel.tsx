import { useEffect, useState, useCallback, useRef } from 'react';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import PlanViewer, { type LiveNodeStats } from '@/components/PlanViewer';
import type { QueryProgressNode, QueryProgressPlanNode } from '@/types/metrics';

interface QueryWatchPanelProps {
  pid: number;
  sql: string;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 800;

function aggregateByNode(nodes: QueryProgressNode[]): Record<number, LiveNodeStats> {
  const byNode: Record<number, { rows: number; segments: Set<number> }> = {};
  for (const n of nodes) {
    const entry = byNode[n.nid] ?? (byNode[n.nid] = { rows: 0, segments: new Set() });
    // ntuples only accumulates once a scan *cycle* completes (InstrEndLoop) —
    // a plain single-pass node (e.g. a driving outer Seq Scan that never
    // rescans) stays at ntuples=0 for its entire run and only shows up in
    // tuplecount (the current, still in-progress cycle's count). Rescanned
    // nodes like Materialize roll most of their total into ntuples quickly,
    // so summing both is correct for either case without needing to know
    // which kind of node this is.
    entry.rows += n.ntuples + n.tuplecount;
    entry.segments.add(n.segid);
  }
  const result: Record<number, LiveNodeStats> = {};
  for (const [nid, v] of Object.entries(byNode)) {
    result[Number(nid)] = { rows: v.rows, segments: v.segments.size };
  }
  return result;
}

// The EXPLAIN-based fallback and WHPG's real plan-shmem capture are two
// independent round trips (see the two effects below); on a server that
// has the real capture, it's normal for /progress to resolve slightly
// slower than the single, lighter EXPLAIN call — rendering EXPLAIN's
// answer the moment it lands, then swapping to the real tree a poll later,
// reads as the whole structure "jumping" to something different (it may
// genuinely be a different plan — a fresh EXPLAIN is a reconstruction, not
// a guarantee, that's the entire point of the real capture). Giving the
// first poll this much of a head start avoids ever showing the wrong one
// in the common case, at the cost of a slightly longer "Loading plan..."
// on servers without the real capture.
const EXPLAIN_FALLBACK_GRACE_MS = 1500;

export default function QueryWatchPanel({ pid, sql, onClose }: QueryWatchPanelProps) {
  const [plan, setPlan] = useState<unknown>(null);
  const [planError, setPlanError] = useState('');
  const [realPlan, setRealPlan] = useState<QueryProgressPlanNode[] | undefined>(undefined);
  const [liveNodes, setLiveNodes] = useState<Record<number, LiveNodeStats>>({});
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [explainGraceElapsed, setExplainGraceElapsed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasRealPlan = !!realPlan && realPlan.length > 0;

  // Fetch the static plan shape once (no ANALYZE — the query is still running)
  useEffect(() => {
    api.explainQuery(sql, false, false)
      .then(res => setPlan(res.plan))
      .catch(e => setPlanError(e instanceof Error ? e.message : 'Failed to fetch plan'));
  }, [sql]);

  useEffect(() => {
    const t = setTimeout(() => setExplainGraceElapsed(true), EXPLAIN_FALLBACK_GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  const poll = useCallback(() => {
    api.getQueryProgress(pid, sql)
      .then(progress => {
        // The shmem slots this reads (gp_instrument_shmem_detail /
        // gp_plan_shmem_detail) recycle the instant the query's backend
        // resource owner releases — i.e. right as it finishes — so the
        // very next poll after completion comes back empty, not 404. Treat
        // that the same as the 404 case below: stop polling and freeze on
        // whatever was last shown, instead of overwriting it with nothing.
        if (progress.nodes.length === 0) {
          setFinished(true);
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        setLiveNodes(aggregateByNode(progress.nodes));
        if (progress.memory && progress.memory.length > 0) {
          setMemoryMb(progress.memory.reduce((sum, m) => sum + m.vmem_mb, 0));
        }
        // WHPG-only: the real plan tree captured at query start (see
        // Capabilities.RealPlanShmem). Absent on any server without the
        // kernel feature; PlanViewer falls back to the EXPLAIN-based
        // reconstruction in that case.
        if (progress.plan && progress.plan.length > 0) {
          setRealPlan(progress.plan);
        }
      })
      .catch(() => {
        // 404 = backend gone, i.e. the query finished (or was cancelled).
        // liveNodes/realPlan are deliberately left untouched here — they
        // keep showing the last snapshot until the user closes the panel.
        setFinished(true);
        if (pollRef.current) clearInterval(pollRef.current);
      });
  }, [pid, sql]);

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-3xl bg-zinc-900 border-l border-zinc-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
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
          {planError && !hasRealPlan && explainGraceElapsed ? (
            <p className="text-sm text-red-400 p-4">{planError}</p>
          ) : hasRealPlan || (explainGraceElapsed && plan) ? (
            <PlanViewer plan={plan} liveNodes={liveNodes} realPlan={realPlan} />
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

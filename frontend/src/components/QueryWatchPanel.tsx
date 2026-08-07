import { useEffect, useState, useCallback, useRef } from 'react';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import PlanViewer, { type LiveNodeStats } from '@/components/PlanViewer';
import type { QueryProgressNode } from '@/types/metrics';

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

export default function QueryWatchPanel({ pid, sql, onClose }: QueryWatchPanelProps) {
  const [plan, setPlan] = useState<unknown>(null);
  const [planError, setPlanError] = useState('');
  const [liveNodes, setLiveNodes] = useState<Record<number, LiveNodeStats>>({});
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [progressError, setProgressError] = useState('');
  const [finished, setFinished] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the static plan shape once (no ANALYZE — the query is still running)
  useEffect(() => {
    api.explainQuery(sql, false, false)
      .then(res => setPlan(res.plan))
      .catch(e => setPlanError(e instanceof Error ? e.message : 'Failed to fetch plan'));
  }, [sql]);

  const poll = useCallback(() => {
    api.getQueryProgress(pid)
      .then(progress => {
        setLiveNodes(aggregateByNode(progress.nodes));
        if (progress.memory && progress.memory.length > 0) {
          setMemoryMb(progress.memory.reduce((sum, m) => sum + m.vmem_mb, 0));
        }
        setProgressError('');
      })
      .catch(e => {
        // 404 = backend gone, i.e. the query finished (or was cancelled)
        setFinished(true);
        setProgressError(e instanceof Error ? e.message : 'Query no longer active');
        if (pollRef.current) clearInterval(pollRef.current);
      });
  }, [pid]);

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
            <span className="flex items-center gap-1.5 text-yellow-400">
              <AlertTriangle size={12} /> {progressError || 'Query finished or is no longer active'}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {planError ? (
            <p className="text-sm text-red-400 p-4">{planError}</p>
          ) : plan ? (
            <PlanViewer plan={plan} liveNodes={liveNodes} />
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

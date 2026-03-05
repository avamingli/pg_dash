import { useEffect, useState, useMemo, useCallback } from 'react';
import { BarChart3, ChevronDown, ChevronRight, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

type Row = Record<string, unknown>;
type Tab = 'time' | 'calls' | 'rows' | 'temp';
type SortDir = 'asc' | 'desc';

const TABS: { key: Tab; label: string }[] = [
  { key: 'time', label: 'By Total Time' },
  { key: 'calls', label: 'By Calls' },
  { key: 'rows', label: 'By Rows' },
  { key: 'temp', label: 'By Temp Usage' },
];

export default function Queries() {
  const [tab, setTab] = useState<Tab>('time');
  const [queries, setQueries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [explainPlan, setExplainPlan] = useState<string | object | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [sortKey, setSortKey] = useState('total_exec_time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [resetConfirm, setResetConfirm] = useState(false);

  const fetchQueries = useCallback(() => {
    setLoading(true);
    api.getTopQueries(tab, 50)
      .then(d => { setQueries(Array.isArray(d) ? d : []); setAvailable(Array.isArray(d)); })
      .catch(() => { setQueries([]); setAvailable(false); })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { fetchQueries(); }, [fetchQueries]);

  const sorted = useMemo(() => {
    return [...queries].sort((a, b) => {
      const va = Number(a[sortKey] ?? 0);
      const vb = Number(b[sortKey] ?? 0);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [queries, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  async function handleExplain(query: string) {
    setExplainLoading(true);
    setExplainPlan(null);
    try {
      const result = await api.explainQuery(query, false, true);
      setExplainPlan(result.plan as string | object);
    } catch (e) {
      setExplainPlan({ error: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setExplainLoading(false);
    }
  }

  async function handleReset() {
    try {
      await api.resetStatements();
      setResetConfirm(false);
      fetchQueries();
    } catch {
      // ignore
    }
  }

  if (!available) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Query Analysis</h1>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-yellow-400 shrink-0 mt-0.5" size={20} />
            <div>
              <h3 className="font-medium text-yellow-300 mb-1">pg_stat_statements not available</h3>
              <p className="text-sm text-zinc-400 mb-3">The pg_stat_statements extension is required for query analysis.</p>
              <div className="bg-zinc-900 rounded p-3 text-sm font-mono text-zinc-300 space-y-1">
                <p>-- Install the extension:</p>
                <p className="text-green-400">CREATE EXTENSION pg_stat_statements;</p>
                <p className="mt-2">-- Add to postgresql.conf:</p>
                <p className="text-green-400">shared_preload_libraries = 'pg_stat_statements'</p>
                <p className="text-green-400">pg_stat_statements.track = all</p>
                <p className="mt-2 text-zinc-500">-- Restart PostgreSQL after config changes</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sortArrow = (key: string) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Query Analysis</h1>
          <BarChart3 size={20} className="text-zinc-500" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchQueries} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setResetConfirm(true)} className="px-3 py-1.5 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors">
            Reset Statistics
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setExpandedIdx(null); }}
            className={`px-4 py-2 text-sm rounded transition-colors ${
              tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-zinc-500"><Loader2 className="animate-spin" size={20} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2 w-8"></th>
                  <th className="p-2 max-w-[400px]">Query</th>
                  {[
                    ['calls', 'Calls'], ['total_exec_time', 'Total (ms)'], ['mean_exec_time', 'Mean (ms)'],
                    ['min_exec_time', 'Min (ms)'], ['max_exec_time', 'Max (ms)'],
                    ['rows', 'Rows'], ['shared_blks_hit', 'Blks Hit'], ['shared_blks_read', 'Blks Read'],
                    ['temp_blks_written', 'Temp Written'],
                  ].map(([key, label]) => (
                    <th key={key} className="p-2 cursor-pointer hover:text-zinc-300 whitespace-nowrap select-none" onClick={() => handleSort(key)}>
                      {label}{sortArrow(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((q, i) => {
                  const isExpanded = expandedIdx === i;
                  const hitRatio = Number(q.shared_blks_hit ?? 0) + Number(q.shared_blks_read ?? 0) > 0
                    ? (Number(q.shared_blks_hit ?? 0) / (Number(q.shared_blks_hit ?? 0) + Number(q.shared_blks_read ?? 0)) * 100)
                    : 100;
                  return (
                    <QueryRow
                      key={i}
                      q={q}
                      hitRatio={hitRatio}
                      isExpanded={isExpanded}
                      onToggle={() => { setExpandedIdx(isExpanded ? null : i); setExplainPlan(null); }}
                      onExplain={() => handleExplain(String(q.query))}
                      explainPlan={isExpanded ? explainPlan : null}
                      explainLoading={isExpanded ? explainLoading : false}
                    />
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td colSpan={12} className="p-6 text-center text-zinc-500">No queries recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reset confirm */}
      {resetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Reset Query Statistics?</h3>
            <p className="text-sm text-zinc-400 mb-4">This will call pg_stat_statements_reset() and clear all accumulated query statistics. This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setResetConfirm(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
              <button onClick={handleReset} className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-500 text-white font-medium">Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QueryRow({ q, hitRatio, isExpanded, onToggle, onExplain, explainPlan, explainLoading }: {
  q: Row; hitRatio: number; isExpanded: boolean; onToggle: () => void;
  onExplain: () => void; explainPlan: string | object | null; explainLoading: boolean;
}) {
  const queryText = String(q.query ?? '');
  return (
    <>
      <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
        <td className="p-2">
          <button onClick={onToggle} className="text-zinc-500 hover:text-zinc-300">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="p-2 text-zinc-300 max-w-[400px] truncate font-mono text-xs" title={queryText}>
          {queryText.slice(0, 100)}
        </td>
        <td className="p-2 font-mono text-zinc-300">{formatNumber(Number(q.calls ?? 0))}</td>
        <td className="p-2 font-mono text-orange-400">{Number(q.total_exec_time ?? 0).toFixed(1)}</td>
        <td className="p-2 font-mono text-zinc-400">{Number(q.mean_exec_time ?? 0).toFixed(2)}</td>
        <td className="p-2 font-mono text-zinc-500">{Number(q.min_exec_time ?? 0).toFixed(2)}</td>
        <td className="p-2 font-mono text-zinc-500">{Number(q.max_exec_time ?? 0).toFixed(2)}</td>
        <td className="p-2 font-mono text-zinc-300">{formatNumber(Number(q.rows ?? 0))}</td>
        <td className="p-2 font-mono text-green-400">{formatNumber(Number(q.shared_blks_hit ?? 0))}</td>
        <td className="p-2 font-mono text-zinc-400">{formatNumber(Number(q.shared_blks_read ?? 0))}</td>
        <td className="p-2 font-mono text-zinc-400">{formatNumber(Number(q.temp_blks_written ?? 0))}</td>
      </tr>
      {isExpanded && (
        <tr className="bg-zinc-800/40">
          <td colSpan={12} className="p-4">
            <div className="space-y-4">
              {/* Full query */}
              <div>
                <p className="text-xs text-zinc-500 mb-1">Full Query:</p>
                <pre className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap break-all max-h-48 overflow-auto font-mono">
                  {queryText}
                </pre>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-zinc-900 rounded p-2">
                  <p className="text-zinc-500">Time Range</p>
                  <p className="text-zinc-200 font-mono">{Number(q.min_exec_time ?? 0).toFixed(2)} — {Number(q.max_exec_time ?? 0).toFixed(2)} ms</p>
                </div>
                <div className="bg-zinc-900 rounded p-2">
                  <p className="text-zinc-500">Stddev</p>
                  <p className="text-zinc-200 font-mono">{Number(q.stddev_exec_time ?? 0).toFixed(2)} ms</p>
                </div>
                <div className="bg-zinc-900 rounded p-2">
                  <p className="text-zinc-500">Cache Hit Ratio</p>
                  <p className={`font-mono ${hitRatio >= 99 ? 'text-green-400' : hitRatio >= 95 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {hitRatio.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-zinc-900 rounded p-2">
                  <p className="text-zinc-500">Block Read/Write Time</p>
                  <p className="text-zinc-200 font-mono">{Number(q.blk_read_time ?? 0).toFixed(1)} / {Number(q.blk_write_time ?? 0).toFixed(1)} ms</p>
                </div>
              </div>

              {/* I/O Breakdown */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                <IOStat label="Shared Hit" value={Number(q.shared_blks_hit ?? 0)} />
                <IOStat label="Shared Read" value={Number(q.shared_blks_read ?? 0)} />
                <IOStat label="Local Hit" value={Number(q.local_blks_hit ?? 0)} />
                <IOStat label="Local Read" value={Number(q.local_blks_read ?? 0)} />
                <IOStat label="Temp Read" value={Number(q.temp_blks_read ?? 0)} />
                <IOStat label="Temp Write" value={Number(q.temp_blks_written ?? 0)} />
              </div>

              {/* WAL stats */}
              {(Number(q.wal_records ?? 0) > 0) && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <IOStat label="WAL Records" value={Number(q.wal_records ?? 0)} />
                  <IOStat label="WAL FPI" value={Number(q.wal_fpi ?? 0)} />
                  <IOStat label="WAL Bytes" value={Number(q.wal_bytes ?? 0)} />
                </div>
              )}

              {/* EXPLAIN button */}
              <div>
                <button onClick={onExplain} disabled={explainLoading}
                  className="px-3 py-1.5 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 transition-colors disabled:opacity-50">
                  {explainLoading ? 'Running EXPLAIN...' : 'EXPLAIN (BUFFERS)'}
                </button>
                {explainPlan && (
                  <div className="mt-3">
                    <p className="text-xs text-zinc-500 mb-1">Execution Plan:</p>
                    <pre className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap max-h-64 overflow-auto font-mono">
                      {typeof explainPlan === 'string' ? explainPlan : JSON.stringify(explainPlan as object, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function IOStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900 rounded p-2">
      <p className="text-zinc-500">{label}</p>
      <p className="text-zinc-200 font-mono">{formatNumber(value)}</p>
    </div>
  );
}

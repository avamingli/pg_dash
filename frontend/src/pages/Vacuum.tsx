import { useEffect, useState, useCallback } from 'react';
import { Trash2, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

type Row = Record<string, unknown>;

export default function Vacuum() {
  const [workers, setWorkers] = useState<Row[]>([]);
  const [progress, setProgress] = useState<Row[]>([]);
  const [needed, setNeeded] = useState<{ tables: Row[]; settings: Row[] }>({ tables: [], settings: [] });
  const [actionMsg, setActionMsg] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    api.getVacuumWorkers().then(setWorkers).catch(() => setWorkers([]));
    api.getVacuumProgress().then(setProgress).catch(() => setProgress([]));
    api.getVacuumNeeded().then(setNeeded).catch(() => setNeeded({ tables: [], settings: [] }));
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  async function triggerAction(schema: string, table: string, action: 'vacuum' | 'analyze') {
    const key = `${schema}.${table}.${action}`;
    setActionLoading(key);
    try {
      if (action === 'vacuum') await api.triggerVacuum(schema, table);
      else await api.triggerAnalyze(schema, table);
      setActionMsg(`${action.toUpperCase()} completed on ${schema}.${table}`);
      setTimeout(() => setActionMsg(''), 3000);
      fetchAll();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : 'unknown'}`);
      setTimeout(() => setActionMsg(''), 5000);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Vacuum</h1>
          <Trash2 size={20} className="text-zinc-500" />
        </div>
        <div className="flex items-center gap-3">
          {actionMsg && (
            <span className={`text-xs ${actionMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
              {actionMsg}
            </span>
          )}
          <button onClick={fetchAll} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Active autovacuum workers */}
      <TableSection title={`Autovacuum Workers (${workers.length})`}>
        {workers.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                <th className="p-2">PID</th>
                <th className="p-2">Database</th>
                <th className="p-2">State</th>
                <th className="p-2">Duration</th>
                <th className="p-2">Query</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="p-2 font-mono text-zinc-400">{String(w.pid)}</td>
                  <td className="p-2 text-zinc-200">{String(w.datname)}</td>
                  <td className="p-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">{String(w.state)}</span>
                  </td>
                  <td className="p-2 font-mono text-yellow-400 text-xs">
                    {w.duration_seconds != null ? `${Number(w.duration_seconds).toFixed(1)}s` : '--'}
                  </td>
                  <td className="p-2 text-zinc-300 truncate max-w-[400px] text-xs font-mono" title={String(w.query)}>
                    {String(w.query ?? '').slice(0, 80)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-zinc-500 p-4">No autovacuum workers currently running</p>
        )}
      </TableSection>

      {/* Vacuum progress */}
      {progress.length > 0 && (
        <TableSection title="Vacuum Progress">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                <th className="p-2">PID</th>
                <th className="p-2">Database</th>
                <th className="p-2">Table</th>
                <th className="p-2">Phase</th>
                <th className="p-2">Heap Blks Total</th>
                <th className="p-2">Scanned</th>
                <th className="p-2">Vacuumed</th>
                <th className="p-2">Progress</th>
              </tr>
            </thead>
            <tbody>
              {progress.map((p, i) => {
                const total = Number(p.heap_blks_total ?? 0);
                const scanned = Number(p.heap_blks_scanned ?? 0);
                const pct = total > 0 ? (scanned / total * 100) : 0;
                return (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono text-zinc-400">{String(p.pid)}</td>
                    <td className="p-2 text-zinc-200">{String(p.datname)}</td>
                    <td className="p-2 text-zinc-200">{String(p.relname ?? p.relid)}</td>
                    <td className="p-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{String(p.phase)}</span>
                    </td>
                    <td className="p-2 font-mono text-zinc-400">{formatNumber(total)}</td>
                    <td className="p-2 font-mono text-zinc-400">{formatNumber(scanned)}</td>
                    <td className="p-2 font-mono text-zinc-400">{formatNumber(Number(p.heap_blks_vacuumed ?? 0))}</td>
                    <td className="p-2 w-32">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-zinc-800 rounded overflow-hidden">
                          <div className="h-full bg-blue-500 rounded transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-zinc-400 font-mono w-10 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableSection>
      )}

      {/* Tables needing vacuum */}
      <TableSection title={`Tables Needing Vacuum (${needed.tables.length})`}>
        {needed.tables.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                <th className="p-2">Schema</th>
                <th className="p-2">Table</th>
                <th className="p-2">Live Rows</th>
                <th className="p-2">Dead Rows</th>
                <th className="p-2">Dead %</th>
                <th className="p-2">Last Vacuum</th>
                <th className="p-2">Last Autovacuum</th>
                <th className="p-2">Last Analyze</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {needed.tables.map((t, i) => {
                const deadPct = Number(t.dead_tuple_ratio ?? 0) * 100;
                const schema = String(t.schemaname);
                const table = String(t.relname);
                const vacKey = `${schema}.${table}.vacuum`;
                const analyzeKey = `${schema}.${table}.analyze`;
                return (
                  <tr key={i} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${deadPct > 20 ? 'border-l-2 border-l-red-500' : deadPct > 10 ? 'border-l-2 border-l-yellow-500' : ''}`}>
                    <td className="p-2 text-zinc-500">{schema}</td>
                    <td className="p-2 text-zinc-200 font-medium">{table}</td>
                    <td className="p-2 font-mono text-zinc-300">{formatNumber(Number(t.n_live_tup ?? 0))}</td>
                    <td className="p-2 font-mono text-zinc-400">{formatNumber(Number(t.n_dead_tup ?? 0))}</td>
                    <td className={`p-2 font-mono ${deadPct > 20 ? 'text-red-400' : deadPct > 10 ? 'text-yellow-400' : 'text-zinc-400'}`}>
                      {deadPct.toFixed(1)}%
                    </td>
                    <td className="p-2 text-xs text-zinc-500">{t.last_vacuum ? new Date(String(t.last_vacuum)).toLocaleString() : 'Never'}</td>
                    <td className="p-2 text-xs text-zinc-500">{t.last_autovacuum ? new Date(String(t.last_autovacuum)).toLocaleString() : 'Never'}</td>
                    <td className="p-2 text-xs text-zinc-500">{t.last_analyze || t.last_autoanalyze ? new Date(String(t.last_analyze || t.last_autoanalyze)).toLocaleString() : 'Never'}</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        <button onClick={() => triggerAction(schema, table, 'vacuum')} disabled={actionLoading === vacKey}
                          className="px-2 py-0.5 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 disabled:opacity-50 transition-colors">
                          {actionLoading === vacKey ? <Loader2 className="animate-spin inline" size={12} /> : 'VACUUM'}
                        </button>
                        <button onClick={() => triggerAction(schema, table, 'analyze')} disabled={actionLoading === analyzeKey}
                          className="px-2 py-0.5 text-xs rounded bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 disabled:opacity-50 transition-colors">
                          {actionLoading === analyzeKey ? <Loader2 className="animate-spin inline" size={12} /> : 'ANALYZE'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-4 flex items-center gap-2 text-sm text-zinc-500">
            <AlertTriangle size={14} className="text-zinc-600" />
            No tables currently need vacuuming
          </div>
        )}
      </TableSection>

      {/* Autovacuum settings */}
      {needed.settings.length > 0 && (
        <TableSection title="Autovacuum Settings">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                <th className="p-2">Setting</th>
                <th className="p-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {needed.settings.map((s, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="p-2 text-zinc-200 font-mono">{String(s.name)}</td>
                  <td className="p-2 text-zinc-400 font-mono">{String(s.setting)}{s.unit ? ` ${s.unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableSection>
      )}
    </div>
  );
}

function TableSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-400">{title}</h3>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

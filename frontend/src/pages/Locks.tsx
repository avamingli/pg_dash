import { useEffect, useState, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Lock as LockIcon, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/api';

type Row = Record<string, unknown>;

const PIE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#6b7280'];
const TT_STYLE = {
  contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '--';
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export default function Locks() {
  const [locksData, setLocksData] = useState<{ locks: Row[]; summary: Row[] }>({ locks: [], summary: [] });
  const [conflictsData, setConflictsData] = useState<{ conflicts: Row[]; blocking_chains: Row[] }>({ conflicts: [], blocking_chains: [] });
  const [search, setSearch] = useState('');
  const [confirmPid, setConfirmPid] = useState<number | null>(null);

  function fetchAll() {
    api.getLocks().then(setLocksData).catch(() => {});
    api.getLockConflicts().then(setConflictsData).catch(() => {});
  }

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 3000);
    return () => clearInterval(id);
  }, []);

  const filteredLocks = useMemo(() => {
    if (!search) return locksData.locks;
    const q = search.toLowerCase();
    return locksData.locks.filter(l =>
      String(l.pid).includes(q) ||
      String(l.relation).toLowerCase().includes(q) ||
      String(l.mode).toLowerCase().includes(q) ||
      String(l.query).toLowerCase().includes(q)
    );
  }, [locksData.locks, search]);

  async function terminatePid(pid: number) {
    try {
      await api.terminateBackend(pid);
    } catch { /* ignore */ }
    setConfirmPid(null);
    fetchAll();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Locks</h1>
          <LockIcon size={20} className="text-zinc-500" />
        </div>
        <button onClick={fetchAll} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary row: Lock type distribution + counts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Lock Mode Distribution</h3>
          {locksData.summary.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={locksData.summary} dataKey="count" nameKey="mode" cx="50%" cy="50%" outerRadius={75} innerRadius={40}
                  paddingAngle={2} label={(props) => `${(props as any).mode}: ${(props as any).count}`} labelLine={{ stroke: '#71717a' }} fontSize={10}>
                  {locksData.summary.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip {...TT_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-500">No locks held</p>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Summary</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/40 rounded p-3">
              <p className="text-xs text-zinc-500">Total Locks</p>
              <p className="text-2xl font-semibold text-zinc-100 tabular-nums">{locksData.locks.length}</p>
            </div>
            <div className="bg-zinc-800/40 rounded p-3">
              <p className="text-xs text-zinc-500">Waiting</p>
              <p className={`text-2xl font-semibold tabular-nums ${locksData.locks.filter(l => !l.granted).length > 0 ? 'text-red-400' : 'text-zinc-100'}`}>
                {locksData.locks.filter(l => !l.granted).length}
              </p>
            </div>
            <div className="bg-zinc-800/40 rounded p-3">
              <p className="text-xs text-zinc-500">Blocking Chains</p>
              <p className={`text-2xl font-semibold tabular-nums ${conflictsData.conflicts.length > 0 ? 'text-yellow-400' : 'text-zinc-100'}`}>
                {conflictsData.conflicts.length}
              </p>
            </div>
            <div className="bg-zinc-800/40 rounded p-3">
              <p className="text-xs text-zinc-500">Lock Types</p>
              <p className="text-2xl font-semibold text-zinc-100 tabular-nums">{locksData.summary.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Current locks table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">Current Locks ({filteredLocks.length})</h3>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            <input type="text" placeholder="Filter locks..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded pl-8 pr-3 py-1 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
          </div>
        </div>
        <div className="overflow-x-auto">
          {filteredLocks.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">PID</th>
                  <th className="p-2">Lock Type</th>
                  <th className="p-2">Database</th>
                  <th className="p-2">Relation</th>
                  <th className="p-2">Mode</th>
                  <th className="p-2">Granted</th>
                  <th className="p-2">User</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Duration</th>
                  <th className="p-2">Query</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocks.map((l, i) => (
                  <tr key={i} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${!l.granted ? 'border-l-2 border-l-red-500' : ''}`}>
                    <td className="p-2 font-mono text-zinc-400">{String(l.pid)}</td>
                    <td className="p-2 text-zinc-400">{String(l.locktype)}</td>
                    <td className="p-2 text-zinc-400">{String(l.database ?? '--')}</td>
                    <td className="p-2 text-zinc-200">{String(l.relation || '--')}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        String(l.mode).includes('Exclusive') ? 'bg-red-500/20 text-red-400' :
                        String(l.mode).includes('Share') ? 'bg-blue-500/20 text-blue-400' :
                        'bg-zinc-700 text-zinc-400'
                      }`}>{String(l.mode)}</span>
                    </td>
                    <td className="p-2">
                      {l.granted
                        ? <span className="text-green-400 text-xs">Yes</span>
                        : <span className="text-red-400 text-xs font-medium">Waiting</span>}
                    </td>
                    <td className="p-2 text-zinc-400">{String(l.usename ?? '--')}</td>
                    <td className="p-2 text-xs text-zinc-500">{String(l.state ?? '--')}</td>
                    <td className="p-2 font-mono text-xs text-zinc-400">{formatDuration(Number(l.duration_seconds))}</td>
                    <td className="p-2 text-zinc-300 truncate max-w-[200px] text-xs" title={String(l.query)}>
                      {String(l.query ?? '--').slice(0, 60)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-zinc-500 p-4">No locks currently held</p>
          )}
        </div>
      </div>

      {/* Blocking chains */}
      {conflictsData.conflicts.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-medium text-red-400">Blocking Chains ({conflictsData.conflicts.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Blocking PID</th>
                  <th className="p-2">Blocker State</th>
                  <th className="p-2">Blocking Query</th>
                  <th className="p-2">Blocked PID</th>
                  <th className="p-2">Wait Duration</th>
                  <th className="p-2">Blocked Query</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {conflictsData.conflicts.map((c, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono text-red-400 font-medium">{String(c.blocking_pid)}</td>
                    <td className="p-2 text-xs text-zinc-400">{String(c.blocking_state)}</td>
                    <td className="p-2 text-zinc-300 truncate max-w-[200px] text-xs" title={String(c.blocking_query)}>
                      {String(c.blocking_query).slice(0, 60)}
                    </td>
                    <td className="p-2 font-mono text-yellow-400">{String(c.blocked_pid)}</td>
                    <td className="p-2 font-mono text-orange-400">{formatDuration(Number(c.blocked_duration_seconds))}</td>
                    <td className="p-2 text-zinc-300 truncate max-w-[200px] text-xs" title={String(c.blocked_query)}>
                      {String(c.blocked_query).slice(0, 60)}
                    </td>
                    <td className="p-2">
                      <button onClick={() => setConfirmPid(Number(c.blocking_pid))}
                        className="px-2 py-0.5 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/40">
                        Kill Blocker
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Blocking tree visualization */}
      {conflictsData.blocking_chains.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-400">Blocking Tree</h3>
          </div>
          <div className="p-4 space-y-2">
            {conflictsData.blocking_chains.map((chain, i) => {
              const blockingPids = chain.blocking_pids as number[] | null;
              return (
                <div key={i} className="flex items-center gap-2 text-sm font-mono">
                  {blockingPids?.map((bp, j) => (
                    <span key={j}>
                      {j > 0 && <span className="text-zinc-600 mx-1">,</span>}
                      <span className="text-red-400">PID {bp}</span>
                    </span>
                  ))}
                  <span className="text-zinc-600 mx-1">→</span>
                  <span className="text-yellow-400">PID {String(chain.pid)}</span>
                  <span className="text-zinc-500 text-xs ml-2">({String(chain.usename)})</span>
                  <span className="text-orange-400 text-xs ml-2">{formatDuration(Number(chain.duration_seconds))}</span>
                  <span className="text-zinc-500 text-xs ml-2 truncate max-w-[300px]">{String(chain.query).slice(0, 60)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Terminate confirmation */}
      {confirmPid != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Terminate Blocking Backend?</h3>
            <p className="text-sm text-zinc-400 mb-4">
              This will terminate PID {confirmPid} using pg_terminate_backend(). The connection will be forcibly closed.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmPid(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
              <button onClick={() => terminatePid(confirmPid)} className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-500 text-white font-medium">Terminate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

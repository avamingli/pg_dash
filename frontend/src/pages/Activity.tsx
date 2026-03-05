import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Users, Activity as ActivityIcon, Clock, AlertTriangle, XCircle,
  ChevronDown, ChevronRight, Search, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useMetrics } from '@/contexts/MetricsContext';
import type { ActivityConnection, ActivitySummary } from '@/types/metrics';

// ── colors ──

const STATE_COLORS: Record<string, string> = {
  active: '#22c55e',
  idle: '#6b7280',
  'idle in transaction': '#eab308',
  'idle in transaction (aborted)': '#ef4444',
  fastpath_function_call: '#8b5cf6',
  disabled: '#71717a',
  unknown: '#71717a',
};

const PIE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

const TT_STYLE = {
  contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
};

// ── helpers ──

function stateRowClass(state: string): string {
  switch (state) {
    case 'active': return 'border-l-2 border-l-green-500';
    case 'idle in transaction': return 'border-l-2 border-l-yellow-500';
    case 'idle in transaction (aborted)': return 'border-l-2 border-l-red-500';
    case 'idle': return 'border-l-2 border-l-zinc-600';
    default: return 'border-l-2 border-l-zinc-700';
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '--';
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function computeDuration(queryStart: string | null): number | null {
  if (!queryStart) return null;
  return (Date.now() - new Date(queryStart).getTime()) / 1000;
}

type SortKey = 'pid' | 'usename' | 'datname' | 'client_addr' | 'state' | 'duration' | 'backend_type' | 'wait_event';
type SortDir = 'asc' | 'desc';

// ── component ──

export default function Activity() {
  const { latest } = useMetrics();
  const [connections, setConnections] = useState<ActivityConnection[]>([]);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [blocked, setBlocked] = useState<Record<string, unknown>[]>([]);
  const [lockConflicts, setLockConflicts] = useState<{ conflicts: Record<string, unknown>[]; blocking_chains: Record<string, unknown>[] } | null>(null);

  // Filters
  const [stateFilter, setStateFilter] = useState('');
  const [dbFilter, setDbFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('pid');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Expanded rows
  const [expandedPid, setExpandedPid] = useState<number | null>(null);

  // Confirmation dialogs
  const [confirmAction, setConfirmAction] = useState<{ pid: number; action: 'cancel' | 'terminate' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch data
  const fetchAll = useCallback(() => {
    api.getActivity().then(setConnections).catch(() => {});
    api.getActivitySummary().then(setSummary).catch(() => {});
    api.getBlocked().then(setBlocked).catch(() => setBlocked([]));
    api.getLockConflicts().then(setLockConflicts).catch(() => setLockConflicts(null));
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 2000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Unique values for filter dropdowns
  const uniqueStates = useMemo(() => [...new Set(connections.map(c => c.state).filter(Boolean))].sort(), [connections]);
  const uniqueDatabases = useMemo(() => [...new Set(connections.map(c => c.datname).filter(Boolean))].sort(), [connections]);
  const uniqueUsers = useMemo(() => [...new Set(connections.map(c => c.usename).filter(Boolean))].sort(), [connections]);

  // Filtered + sorted connections
  const filtered = useMemo(() => {
    let list = connections;
    if (stateFilter) list = list.filter(c => c.state === stateFilter);
    if (dbFilter) list = list.filter(c => c.datname === dbFilter);
    if (userFilter) list = list.filter(c => c.usename === userFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        c.query.toLowerCase().includes(q) ||
        String(c.pid).includes(q) ||
        c.usename.toLowerCase().includes(q) ||
        c.datname.toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      let va: string | number, vb: string | number;
      if (sortKey === 'duration') {
        va = computeDuration(a.query_start) ?? -1;
        vb = computeDuration(b.query_start) ?? -1;
      } else {
        va = a[sortKey] as string | number;
        vb = b[sortKey] as string | number;
      }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [connections, stateFilter, dbFilter, userFilter, searchQuery, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  async function handleAction() {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      if (confirmAction.action === 'cancel') {
        await api.cancelBackend(confirmAction.pid);
      } else {
        await api.terminateBackend(confirmAction.pid);
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      fetchAll();
    }
  }

  // Summary stat counts
  const conns = latest?.pg?.connections;
  const totalCount = conns?.total ?? connections.length;
  const activeCount = conns?.active ?? 0;
  const idleCount = conns?.idle ?? 0;
  const idleTxCount = conns?.idle_in_transaction ?? 0;
  const blockedCount = blocked.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity Monitor</h1>
        <button onClick={fetchAll} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* ── Summary Panel ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard icon={Users} label="Total" value={totalCount} color="text-blue-400 bg-blue-400/10" />
        <SummaryCard icon={ActivityIcon} label="Active" value={activeCount} color="text-green-400 bg-green-400/10" />
        <SummaryCard icon={Clock} label="Idle" value={idleCount} color="text-zinc-400 bg-zinc-400/10" />
        <SummaryCard icon={AlertTriangle} label="Idle in Tx" value={idleTxCount} color="text-yellow-400 bg-yellow-400/10" />
        <SummaryCard icon={XCircle} label="Blocked" value={blockedCount} color="text-red-400 bg-red-400/10" />
      </div>

      {/* ── Charts: By State + By Database ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Connections by State</h3>
          {summary?.by_state && summary.by_state.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={summary.by_state} layout="vertical">
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="#3f3f46" fontSize={11} tick={{ fill: '#71717a' }} />
                <YAxis type="category" dataKey="label" stroke="#3f3f46" fontSize={11} tick={{ fill: '#a1a1aa' }} width={120} />
                <Tooltip {...TT_STYLE} />
                <Bar dataKey="count" name="Connections" radius={[0, 4, 4, 0]}>
                  {summary.by_state.map((entry, i) => (
                    <Cell key={i} fill={STATE_COLORS[entry.label] || '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-500">No data</p>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Connections by Database</h3>
          {summary?.by_database && summary.by_database.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={summary.by_database}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={40}
                  paddingAngle={2}
                  label={(props) => `${(props as any).label}: ${(props as any).count}`}
                  labelLine={{ stroke: '#71717a' }}
                  fontSize={11}
                >
                  {summary.by_database.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...TT_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-500">No data</p>
          )}
        </div>
      </div>

      {/* ── Filters Bar ── */}
      <div className="flex flex-wrap items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          <input
            type="text"
            placeholder="Search PID, user, database, or query..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded pl-8 pr-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <FilterSelect label="State" value={stateFilter} options={uniqueStates} onChange={setStateFilter} />
        <FilterSelect label="Database" value={dbFilter} options={uniqueDatabases} onChange={setDbFilter} />
        <FilterSelect label="User" value={userFilter} options={uniqueUsers} onChange={setUserFilter} />

        {(stateFilter || dbFilter || userFilter || searchQuery) && (
          <button
            onClick={() => { setStateFilter(''); setDbFilter(''); setUserFilter(''); setSearchQuery(''); }}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-zinc-500 ml-auto">{filtered.length} connection{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Main Connections Table ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800 bg-zinc-900/80">
                <th className="p-2 w-8"></th>
                <SortHeader label="PID" sortKey="pid" current={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="User" sortKey="usename" current={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Database" sortKey="datname" current={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Client IP" sortKey="client_addr" current={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="State" sortKey="state" current={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Wait Event" sortKey="wait_event" current={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Duration" sortKey="duration" current={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Backend" sortKey="backend_type" current={sortKey} dir={sortDir} onClick={handleSort} />
                <th className="p-2">Query</th>
                <th className="p-2 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(conn => {
                const dur = computeDuration(conn.query_start);
                const isExpanded = expandedPid === conn.pid;
                return (
                  <ConnectionRow
                    key={conn.pid}
                    conn={conn}
                    duration={dur}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedPid(isExpanded ? null : conn.pid)}
                    onCancel={() => setConfirmAction({ pid: conn.pid, action: 'cancel' })}
                    onTerminate={() => setConfirmAction({ pid: conn.pid, action: 'terminate' })}
                  />
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="p-6 text-center text-zinc-500">No connections match filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Blocked Queries Section ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-400">Blocking Chains</h3>
        </div>
        <div className="overflow-x-auto">
          {lockConflicts?.conflicts && lockConflicts.conflicts.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Blocking PID</th>
                  <th className="p-2">Blocking User</th>
                  <th className="p-2">Blocking Query</th>
                  <th className="p-2">Blocking State</th>
                  <th className="p-2">Blocked PID</th>
                  <th className="p-2">Blocked User</th>
                  <th className="p-2">Wait Duration</th>
                  <th className="p-2">Blocked Query</th>
                </tr>
              </thead>
              <tbody>
                {lockConflicts.conflicts.map((c, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono text-red-400">{String(c.blocking_pid)}</td>
                    <td className="p-2 text-zinc-400">{String(c.blocking_user)}</td>
                    <td className="p-2 text-zinc-300 truncate max-w-[200px]" title={String(c.blocking_query)}>
                      {String(c.blocking_query).slice(0, 60)}
                    </td>
                    <td className="p-2">
                      <StateBadge state={String(c.blocking_state)} />
                    </td>
                    <td className="p-2 font-mono text-yellow-400">{String(c.blocked_pid)}</td>
                    <td className="p-2 text-zinc-400">{String(c.blocked_user)}</td>
                    <td className="p-2 font-mono text-orange-400">
                      {formatDuration(Number(c.blocked_duration_seconds))}
                    </td>
                    <td className="p-2 text-zinc-300 truncate max-w-[200px]" title={String(c.blocked_query)}>
                      {String(c.blocked_query).slice(0, 60)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-zinc-500 p-4">No blocking chains detected</p>
          )}
        </div>
      </div>

      {/* ── Blocking Tree (from blocking_chains) ── */}
      {lockConflicts?.blocking_chains && lockConflicts.blocking_chains.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-400">Blocked Sessions Tree</h3>
          </div>
          <div className="p-4 space-y-2">
            {lockConflicts.blocking_chains.map((chain, i) => {
              const blockingPids = chain.blocking_pids as number[] | null;
              return (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <div className="flex items-center gap-1 shrink-0">
                    {blockingPids && blockingPids.length > 0 && (
                      <>
                        <span className="font-mono text-red-400">PID {blockingPids.join(', ')}</span>
                        <span className="text-zinc-600 mx-1">→</span>
                      </>
                    )}
                    <span className="font-mono text-yellow-400">PID {String(chain.pid)}</span>
                    <span className="text-zinc-500 ml-2">({String(chain.usename)}@{String(chain.datname)})</span>
                    <span className="font-mono text-orange-400 ml-2">{formatDuration(Number(chain.duration_seconds))}</span>
                  </div>
                  <span className="text-zinc-400 truncate" title={String(chain.query)}>
                    {String(chain.query).slice(0, 80)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Confirmation Dialog ── */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-2">
              {confirmAction.action === 'cancel' ? 'Cancel Query' : 'Terminate Backend'}
            </h3>
            <p className="text-sm text-zinc-400 mb-4">
              {confirmAction.action === 'cancel'
                ? `Cancel the running query for PID ${confirmAction.pid}? The backend will continue running.`
                : `Terminate backend PID ${confirmAction.pid}? The connection will be forcibly closed.`}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={actionLoading}
                className={`px-4 py-2 text-sm rounded font-medium transition-colors ${
                  confirmAction.action === 'terminate'
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-yellow-600 hover:bg-yellow-500 text-white'
                } disabled:opacity-50`}
              >
                {actionLoading ? 'Processing...' : confirmAction.action === 'cancel' ? 'Cancel Query' : 'Terminate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number; color: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${color}`}><Icon size={18} /></div>
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-semibold text-zinc-100 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
    >
      <option value="">All {label}s</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SortHeader({ label, sortKey, current, dir, onClick }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void;
}) {
  return (
    <th
      className="p-2 cursor-pointer hover:text-zinc-300 transition-colors select-none whitespace-nowrap"
      onClick={() => onClick(sortKey)}
    >
      {label}
      {current === sortKey && <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

function StateBadge({ state }: { state: string }) {
  const color = STATE_COLORS[state] || '#71717a';
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {state || 'unknown'}
    </span>
  );
}

function ConnectionRow({ conn, duration, isExpanded, onToggle, onCancel, onTerminate }: {
  conn: ActivityConnection;
  duration: number | null;
  isExpanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onTerminate: () => void;
}) {
  const waitEvent = conn.wait_event_type
    ? `${conn.wait_event_type}:${conn.wait_event}`
    : conn.wait_event || '--';

  return (
    <>
      <tr className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${stateRowClass(conn.state)}`}>
        <td className="p-2">
          <button onClick={onToggle} className="text-zinc-500 hover:text-zinc-300">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="p-2 font-mono text-zinc-400">{conn.pid}</td>
        <td className="p-2 text-zinc-300">{conn.usename || '--'}</td>
        <td className="p-2 text-zinc-300">{conn.datname || '--'}</td>
        <td className="p-2 font-mono text-zinc-500 text-xs">{conn.client_addr || '--'}</td>
        <td className="p-2"><StateBadge state={conn.state} /></td>
        <td className="p-2 text-xs text-zinc-500 font-mono">{waitEvent}</td>
        <td className="p-2 font-mono text-zinc-400">
          {duration != null && duration > 0 ? (
            <span className={duration > 60 ? 'text-red-400' : duration > 10 ? 'text-yellow-400' : ''}>
              {formatDuration(duration)}
            </span>
          ) : '--'}
        </td>
        <td className="p-2 text-xs text-zinc-500">{conn.backend_type}</td>
        <td className="p-2 text-zinc-300 truncate max-w-[300px]" title={conn.query}>
          {conn.query ? conn.query.slice(0, 80) : '--'}
        </td>
        <td className="p-2">
          <div className="flex gap-1">
            {conn.state === 'active' && conn.pid > 0 && (
              <button
                onClick={e => { e.stopPropagation(); onCancel(); }}
                className="px-2 py-0.5 text-xs rounded bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/40 transition-colors"
                title="Cancel query"
              >
                Cancel
              </button>
            )}
            {conn.pid > 0 && conn.backend_type === 'client backend' && (
              <button
                onClick={e => { e.stopPropagation(); onTerminate(); }}
                className="px-2 py-0.5 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors"
                title="Terminate backend"
              >
                Kill
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-zinc-800/40">
          <td colSpan={11} className="p-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-zinc-500">Backend Start:</span>{' '}
                  <span className="text-zinc-300">{conn.backend_start ? new Date(conn.backend_start).toLocaleString() : '--'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Xact Start:</span>{' '}
                  <span className="text-zinc-300">{conn.xact_start ? new Date(conn.xact_start).toLocaleString() : '--'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Query Start:</span>{' '}
                  <span className="text-zinc-300">{conn.query_start ? new Date(conn.query_start).toLocaleString() : '--'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">State Change:</span>{' '}
                  <span className="text-zinc-300">{conn.state_change ? new Date(conn.state_change).toLocaleString() : '--'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Client Port:</span>{' '}
                  <span className="text-zinc-300">{conn.client_port || '--'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Wait Event:</span>{' '}
                  <span className="text-zinc-300">{waitEvent}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Query ID:</span>{' '}
                  <span className="text-zinc-300 font-mono">{conn.query_id || '--'}</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1">Full Query:</p>
                <pre className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap break-all max-h-48 overflow-auto font-mono">
                  {conn.query || '(no query)'}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

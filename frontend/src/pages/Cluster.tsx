import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Server, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { useMetrics } from '@/contexts/MetricsContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/utils';
import StatCard from '@/components/StatCard';
import type {
  SegmentInfo, ConfigHistoryEntry, ResourceQueueStatus,
  ResourceGroupStatus, PerSegmentStats, WorkfileUsage,
} from '@/types/metrics';

const GRID = { stroke: '#27272a', strokeDasharray: '3 3' };
const AXIS = { stroke: '#3f3f46', fontSize: 11, tick: { fill: '#71717a' } };
const TT_STYLE = { contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }, labelStyle: { color: '#a1a1aa' } };

export default function Cluster() {
  const { latest, clusterInfo } = useMetrics();
  const [topology, setTopology] = useState<SegmentInfo[]>([]);
  const [history, setHistory] = useState<ConfigHistoryEntry[]>([]);
  const [resQueues, setResQueues] = useState<ResourceQueueStatus[]>([]);
  const [resGroups, setResGroups] = useState<ResourceGroupStatus[]>([]);
  const [segStats, setSegStats] = useState<PerSegmentStats[]>([]);
  const [workfiles, setWorkfiles] = useState<WorkfileUsage[]>([]);
  const [dataSkew, setDataSkew] = useState<Record<string, unknown>[]>([]);
  const [hostMetrics, setHostMetrics] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clusterInfo || clusterInfo.mode === 'postgresql') return;
    setLoading(true);
    Promise.allSettled([
      api.getClusterTopology().then(setTopology),
      api.getClusterHistory(50).then(setHistory),
      clusterInfo.resource_mgr === 'queue'
        ? api.getResourceQueues().then(setResQueues)
        : api.getResourceGroups().then(setResGroups),
      api.getSegmentStats().then(setSegStats),
      api.getWorkfileSegments().then(setWorkfiles),
      api.getDataSkew().then(d => setDataSkew(Array.isArray(d) ? d : [])),
      api.getHostMetrics().then(d => setHostMetrics(Array.isArray(d) ? d : [])),
    ]).finally(() => setLoading(false));
  }, [clusterInfo]);

  // Refresh segment stats every 10s
  useEffect(() => {
    if (!clusterInfo || clusterInfo.mode === 'postgresql') return;
    const id = setInterval(() => {
      api.getSegmentStats().then(setSegStats).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [clusterInfo]);

  const health = latest?.cluster?.cluster_health;
  const replication = latest?.cluster?.segment_replication;

  if (!clusterInfo || clusterInfo.mode === 'postgresql') {
    return (
      <div className="text-zinc-500 text-center py-20">
        <p className="text-lg">Not connected to a distributed cluster.</p>
        <p className="text-sm mt-2">This page is available when connected to Apache Cloudberry or CBDB.</p>
      </div>
    );
  }

  const modeName = 'Apache Cloudberry';

  // Per-segment TPS chart data
  const segTpsData = segStats
    .filter(s => s.gp_segment_id >= 0)
    .map(s => ({
      seg: `Seg ${s.gp_segment_id}`,
      tps: s.xact_commit + s.xact_rollback,
      hit_ratio: s.blks_hit + s.blks_read > 0
        ? ((s.blks_hit / (s.blks_hit + s.blks_read)) * 100)
        : 100,
      temp_bytes: s.temp_bytes,
    }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cluster</h1>

      {/* Row 1: Cluster Info Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-center gap-4">
        <span className="text-sm font-medium px-3 py-1 rounded bg-emerald-500/10 text-emerald-400">
          {modeName} {clusterInfo.version}
        </span>
        <span className="text-sm text-zinc-400">
          {clusterInfo.num_segments} primaries {clusterInfo.has_mirrors ? `+ ${clusterInfo.num_segments} mirrors` : '(no mirrors)'}
        </span>
        <span className="text-sm text-zinc-500">
          Resource Manager: <span className="text-zinc-300">{clusterInfo.resource_mgr}</span>
        </span>
      </div>

      {/* Row 2: Health Stat Cards */}
      {health && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Primaries"
            value={`${health.primaries_up} / ${health.primaries_up + health.primaries_down}`}
            subtitle={health.primaries_down > 0 ? `${health.primaries_down} DOWN` : 'All up'}
            icon={Server}
            color={health.primaries_down > 0 ? 'red' : 'green'}
          />
          <StatCard
            title="Mirrors"
            value={`${health.mirrors_up} / ${health.mirrors_up + health.mirrors_down}`}
            subtitle={health.mirrors_down > 0 ? `${health.mirrors_down} DOWN` : 'All up'}
            icon={Server}
            color={health.mirrors_down > 0 ? 'red' : 'green'}
          />
          <StatCard
            title="Sync Status"
            value={health.not_synchronized > 0 ? `${health.not_synchronized} not synced` : 'All synced'}
            icon={RefreshCw}
            color={health.not_synchronized > 0 ? 'yellow' : 'green'}
          />
          <StatCard
            title="Balance"
            value={health.unbalanced > 0 ? `${health.unbalanced} unbalanced` : 'Balanced'}
            icon={ShieldCheck}
            color={health.unbalanced > 0 ? 'yellow' : 'green'}
          />
        </div>
      )}

      {/* Row 3: Segment Topology Table */}
      <Section title="Segment Topology">
        {loading && topology.length === 0 ? (
          <p className="text-sm text-zinc-500 p-3">Loading...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Content</th>
                  <th className="p-2">Dbid</th>
                  <th className="p-2">Role</th>
                  <th className="p-2">Preferred</th>
                  <th className="p-2">Mode</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Hostname</th>
                  <th className="p-2">Port</th>
                </tr>
              </thead>
              <tbody>
                {topology.map((s) => (
                  <tr
                    key={s.dbid}
                    className={cn(
                      'border-b border-zinc-800/50',
                      s.status === 'down' && 'bg-red-500/10',
                      s.status === 'up' && !s.is_balanced && 'bg-yellow-500/10',
                      s.status === 'up' && s.mode === 'not_synced' && 'bg-orange-500/10',
                    )}
                  >
                    <td className="p-2 font-mono">
                      {s.is_coordinator ? (
                        <span className="text-emerald-400">coord</span>
                      ) : (
                        s.content_id
                      )}
                    </td>
                    <td className="p-2 font-mono text-zinc-400">{s.dbid}</td>
                    <td className="p-2">
                      <span className={cn(
                        'text-xs font-medium px-1.5 py-0.5 rounded',
                        s.role === 'primary' ? 'bg-blue-400/10 text-blue-400' : 'bg-zinc-700 text-zinc-300',
                      )}>
                        {s.role}
                      </span>
                    </td>
                    <td className="p-2 text-zinc-400">{s.preferred_role}</td>
                    <td className="p-2">
                      <span className={cn(
                        'text-xs',
                        s.mode === 'synchronized' ? 'text-green-400' : 'text-yellow-400',
                      )}>
                        {s.mode}
                      </span>
                    </td>
                    <td className="p-2">
                      <span className={cn(
                        'text-xs font-bold',
                        s.status === 'up' ? 'text-green-400' : 'text-red-400',
                      )}>
                        {s.status}
                      </span>
                    </td>
                    <td className="p-2 text-zinc-400">{s.hostname}</td>
                    <td className="p-2 font-mono text-zinc-400">{s.port}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Row 4: Replication Status */}
      {replication && replication.length > 0 && (
        <Section title="Segment Replication">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Segment</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Sync State</th>
                  <th className="p-2">Sync Error</th>
                  <th className="p-2">Write Lag</th>
                  <th className="p-2">Flush Lag</th>
                  <th className="p-2">Replay Lag</th>
                </tr>
              </thead>
              <tbody>
                {replication.map((r) => (
                  <tr key={r.gp_segment_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono">
                      {r.gp_segment_id === -1 ? (
                        <span className="text-emerald-400">coord</span>
                      ) : (
                        `Seg ${r.gp_segment_id}`
                      )}
                    </td>
                    <td className="p-2">
                      <span className={cn('text-xs', r.state === 'streaming' ? 'text-green-400' : 'text-yellow-400')}>
                        {r.state}
                      </span>
                    </td>
                    <td className="p-2 text-zinc-400">{r.sync_state}</td>
                    <td className="p-2">
                      <span className={cn('text-xs', r.sync_error !== 'none' ? 'text-red-400 font-bold' : 'text-zinc-500')}>
                        {r.sync_error}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-zinc-400">{r.write_lag || '-'}</td>
                    <td className="p-2 font-mono text-zinc-400">{r.flush_lag || '-'}</td>
                    <td className="p-2 font-mono text-zinc-400">{r.replay_lag || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Row 5: FTS History */}
      {history.length > 0 && (
        <Section title="FTS Configuration History">
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-900">
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Time</th>
                  <th className="p-2">Dbid</th>
                  <th className="p-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="p-2 font-mono text-zinc-400 whitespace-nowrap">{e.time}</td>
                    <td className="p-2 font-mono text-zinc-400">{e.dbid}</td>
                    <td className="p-2 text-zinc-300">{e.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Row 6: Resource Management */}
      {clusterInfo.resource_mgr === 'queue' && resQueues.length > 0 && (
        <Section title="Resource Queues">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Queue</th>
                  <th className="p-2">Count (used/limit)</th>
                  <th className="p-2">Cost (used/limit)</th>
                  <th className="p-2">Memory (used/limit)</th>
                  <th className="p-2">Waiters</th>
                  <th className="p-2">Holders</th>
                </tr>
              </thead>
              <tbody>
                {resQueues.map((q) => (
                  <tr key={q.name} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-medium text-zinc-200">{q.name}</td>
                    <td className="p-2 font-mono text-zinc-400">{q.count_value} / {q.count_limit}</td>
                    <td className="p-2 font-mono text-zinc-400">{q.cost_value} / {q.cost_limit}</td>
                    <td className="p-2 font-mono text-zinc-400">{q.memory_value} / {q.memory_limit}</td>
                    <td className={cn('p-2 font-mono', q.waiters > 0 ? 'text-yellow-400' : 'text-zinc-500')}>
                      {q.waiters}
                    </td>
                    <td className="p-2 font-mono text-zinc-400">{q.holders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {clusterInfo.resource_mgr === 'group' && resGroups.length > 0 && (
        <Section title="Resource Groups">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Group</th>
                  <th className="p-2">Running</th>
                  <th className="p-2">Queueing</th>
                  <th className="p-2">Total Queued</th>
                  <th className="p-2">Total Executed</th>
                  <th className="p-2">Queue Duration</th>
                </tr>
              </thead>
              <tbody>
                {resGroups.map((g) => (
                  <tr key={g.group_name} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-medium text-zinc-200">{g.group_name}</td>
                    <td className="p-2 font-mono text-zinc-400">{g.num_running}</td>
                    <td className={cn('p-2 font-mono', g.num_queueing > 0 ? 'text-yellow-400' : 'text-zinc-500')}>
                      {g.num_queueing}
                    </td>
                    <td className="p-2 font-mono text-zinc-400">{g.num_queued}</td>
                    <td className="p-2 font-mono text-zinc-400">{g.num_executed}</td>
                    <td className="p-2 font-mono text-zinc-400">{g.total_queue_duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Row 6.5: Per-Host Metrics */}
      {hostMetrics.length > 0 && (
        <Section title="Host Metrics">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Hostname</th>
                  <th className="p-2">Primaries</th>
                  <th className="p-2">Mirrors</th>
                  <th className="p-2">Down</th>
                  <th className="p-2">Unbalanced</th>
                  <th className="p-2">Total TPS</th>
                  <th className="p-2">Cache Hit %</th>
                  <th className="p-2">Temp Bytes</th>
                </tr>
              </thead>
              <tbody>
                {hostMetrics.map((h, i) => {
                  const down = Number(h.down_count ?? 0);
                  const unbal = Number(h.unbalanced_count ?? 0);
                  const hitRatio = Number(h.cache_hit_ratio ?? 100);
                  return (
                    <tr key={i} className={cn(
                      'border-b border-zinc-800/50 hover:bg-zinc-800/30',
                      down > 0 && 'bg-red-500/10',
                    )}>
                      <td className="p-2 font-mono text-zinc-200">{String(h.hostname)}</td>
                      <td className="p-2 font-mono text-zinc-400">{String(h.primary_count ?? 0)}</td>
                      <td className="p-2 font-mono text-zinc-400">{String(h.mirror_count ?? 0)}</td>
                      <td className={cn('p-2 font-mono', down > 0 ? 'text-red-400 font-bold' : 'text-zinc-500')}>
                        {down}
                      </td>
                      <td className={cn('p-2 font-mono', unbal > 0 ? 'text-yellow-400' : 'text-zinc-500')}>
                        {unbal}
                      </td>
                      <td className="p-2 font-mono text-zinc-400">{Number(h.total_tps ?? 0).toLocaleString()}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', hitRatio >= 99 ? 'bg-green-500' : hitRatio >= 95 ? 'bg-yellow-500' : 'bg-red-500')}
                              style={{ width: `${hitRatio}%` }}
                            />
                          </div>
                          <span className={cn('text-xs font-mono', hitRatio >= 99 ? 'text-green-400' : hitRatio >= 95 ? 'text-yellow-400' : 'text-red-400')}>
                            {hitRatio}%
                          </span>
                        </div>
                      </td>
                      <td className="p-2 font-mono text-zinc-400">{formatBytes(Number(h.total_temp_bytes ?? 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Row 7: Per-Segment Performance Charts */}
      {segTpsData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Transactions per Segment (cumulative)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={segTpsData}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="seg" {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip {...TT_STYLE} />
                <Bar dataKey="tps" name="TPS" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Cache Hit Ratio per Segment (%)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={segTpsData}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="seg" {...AXIS} />
                <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Bar dataKey="hit_ratio" name="Cache Hit %" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* Row 8: Temp Bytes per segment */}
      {segTpsData.some(s => s.temp_bytes > 0) && (
        <ChartCard title="Temp Bytes per Segment">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={segTpsData}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="seg" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={(v: number) => formatBytes(v)} />
              <Tooltip {...TT_STYLE} formatter={(v: number) => formatBytes(v)} />
              <Bar dataKey="temp_bytes" name="Temp Bytes" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Row 9: Workfile/Spill Usage */}
      {workfiles.length > 0 && workfiles.some(w => w.size > 0) && (
        <Section title="Workfile (Spill) Usage per Segment">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Segment</th>
                  <th className="p-2">Size</th>
                  <th className="p-2">Files</th>
                </tr>
              </thead>
              <tbody>
                {workfiles.map((w) => (
                  <tr key={w.gp_segment_id} className={cn(
                    'border-b border-zinc-800/50',
                    w.size > 100 * 1024 * 1024 && 'bg-yellow-500/10',
                  )}>
                    <td className="p-2 font-mono">Seg {w.gp_segment_id}</td>
                    <td className="p-2 font-mono text-zinc-400">{formatBytes(w.size)}</td>
                    <td className="p-2 font-mono text-zinc-400">{w.num_files}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Row 10: Data Skew */}
      {dataSkew.length > 0 && (
        <Section title="Data Skew (coefficient > 5)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Schema</th>
                  <th className="p-2">Table</th>
                  <th className="p-2">Skew Coefficient</th>
                  <th className="p-2">Severity</th>
                </tr>
              </thead>
              <tbody>
                {dataSkew.map((s, i) => {
                  const coeff = Number(s.coefficient ?? 0);
                  return (
                    <tr key={i} className={cn(
                      'border-b border-zinc-800/50',
                      coeff > 20 && 'bg-red-500/10',
                      coeff > 5 && coeff <= 20 && 'bg-yellow-500/10',
                    )}>
                      <td className="p-2 text-zinc-400">{String(s.schema)}</td>
                      <td className="p-2 font-mono text-zinc-300">{String(s.table_name)}</td>
                      <td className="p-2 font-mono">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-zinc-800 rounded-full max-w-[120px]">
                            <div
                              className={cn(
                                'h-2 rounded-full',
                                coeff > 20 ? 'bg-red-500' : coeff > 10 ? 'bg-orange-500' : 'bg-yellow-500'
                              )}
                              style={{ width: `${Math.min(100, coeff * 2)}%` }}
                            />
                          </div>
                          <span className={cn(
                            coeff > 20 ? 'text-red-400' : coeff > 10 ? 'text-orange-400' : 'text-yellow-400'
                          )}>
                            {coeff.toFixed(1)}
                          </span>
                        </div>
                      </td>
                      <td className="p-2">
                        <span className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          coeff > 20 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                        )}>
                          {coeff > 20 ? 'Critical' : 'Warning'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── sub-components ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-400">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

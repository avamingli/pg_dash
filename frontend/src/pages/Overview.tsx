import { useMemo, useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Users, Zap, Database, Cpu, HardDrive, TrendingUp, AlertTriangle,
} from 'lucide-react';
import { useMetrics } from '@/contexts/MetricsContext';
import { api } from '@/lib/api';
import { formatBytes, formatPercent } from '@/lib/utils';
import StatCard from '@/components/StatCard';
import TimeRangeSelector, { type TimeRange, timeRangeToISO } from '@/components/TimeRangeSelector';
import type { MetricsSnapshot } from '@/types/metrics';

// ── helpers ──

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function cacheColor(ratio: number) {
  if (ratio >= 99) return 'green' as const;
  if (ratio >= 95) return 'yellow' as const;
  return 'red' as const;
}

// keep only last N minutes of history for charts
function sliceHistory<T>(arr: T[], maxLen: number) {
  return arr.length > maxLen ? arr.slice(arr.length - maxLen) : arr;
}

// ── chart theme ──

const GRID = { stroke: '#27272a', strokeDasharray: '3 3' };
const AXIS = { stroke: '#3f3f46', fontSize: 11, tick: { fill: '#71717a' } };
const TT_STYLE = { contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }, labelStyle: { color: '#a1a1aa' } };

// ── component ──

export default function Overview() {
  const { latest, history } = useMetrics();
  const [longRunning, setLongRunning] = useState<Record<string, unknown>[]>([]);
  const [topQueries, setTopQueries] = useState<Record<string, unknown>[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>('realtime');
  const [historicalSnapshots, setHistoricalSnapshots] = useState<MetricsSnapshot[]>([]);

  // Fetch long-running queries and top statements every 10s
  useEffect(() => {
    function fetchTables() {
      api.getLongRunning('1 second')
        .then(d => setLongRunning((d ?? []).slice(0, 5)))
        .catch(() => {});
      api.getTopQueries('time', 5)
        .then(d => setTopQueries(Array.isArray(d) ? d : []))
        .catch(() => setTopQueries([]));
    }
    fetchTables();
    const id = setInterval(fetchTables, 10_000);
    return () => clearInterval(id);
  }, []);

  // Fetch historical snapshots when time range changes
  const fetchHistorical = useCallback(() => {
    const range = timeRangeToISO(timeRange);
    if (!range) {
      setHistoricalSnapshots([]);
      return;
    }
    api.getSnapshots(range.from, range.to)
      .then(d => setHistoricalSnapshots(d ?? []))
      .catch(() => setHistoricalSnapshots([]));
  }, [timeRange]);

  useEffect(() => {
    fetchHistorical();
  }, [fetchHistorical]);

  // Use historical data or real-time data based on selector
  const dataSource = timeRange === 'realtime' ? history : historicalSnapshots;

  // Prepare chart data from history (last 5 min = 150 points max for realtime)
  const chartData = useMemo(() => {
    const h = timeRange === 'realtime' ? sliceHistory(dataSource, 150) : dataSource;
    return h.map(s => ({
      time: fmtTime(s.timestamp),
      // TPS (these are cumulative counters; we show raw for now — delta computed below)
      commits: s.pg?.tps?.commits ?? 0,
      rollbacks: s.pg?.tps?.rollbacks ?? 0,
      // Connection states
      active: s.pg?.connections?.active ?? 0,
      idle: s.pg?.connections?.idle ?? 0,
      idle_tx: s.pg?.connections?.idle_in_transaction ?? 0,
      // CPU
      cpu_user: s.system?.cpu?.user ?? 0,
      cpu_system: s.system?.cpu?.system ?? 0,
      cpu_iowait: s.system?.cpu?.iowait ?? 0,
      cpu_usage: s.system?.cpu?.usage_percent ?? 0,
      // Disk I/O (sum across devices)
      read_mbps: (s.system?.disk_io ?? []).reduce((a, d) => a + d.read_bps, 0) / 1024 / 1024,
      write_mbps: (s.system?.disk_io ?? []).reduce((a, d) => a + d.write_bps, 0) / 1024 / 1024,
    }));
  }, [dataSource, timeRange]);

  // Compute TPS deltas (difference between consecutive snapshots / 2s)
  const tpsData = useMemo(() => {
    if (chartData.length < 2) return [];
    return chartData.slice(1).map((curr, i) => {
      const prev = chartData[i];
      const dc = Math.max(0, curr.commits - prev.commits);
      const dr = Math.max(0, curr.rollbacks - prev.rollbacks);
      return {
        time: curr.time,
        commits: Math.round(dc / 2),
        rollbacks: Math.round(dr / 2),
      };
    });
  }, [chartData]);

  // Current stat values
  const conns = latest?.pg?.connections;
  const cacheHit = latest?.pg?.cache_hit_ratio ?? 0;
  const totalDbSize = (latest?.pg?.database_sizes ?? []).reduce((a, d) => a + d.size, 0);
  const cpuUsage = latest?.system?.cpu?.usage_percent ?? 0;
  const diskIO = latest?.system?.disk_io ?? [];
  const totalReadMBps = diskIO.reduce((a, d) => a + d.read_bps, 0) / 1024 / 1024;
  const totalWriteMBps = diskIO.reduce((a, d) => a + d.write_bps, 0) / 1024 / 1024;
  const logStats = latest?.pg?.log_stats;

  // Log severity chart data from WebSocket history
  const logChartData = useMemo(() => {
    const counts = logStats?.hourly_counts ?? [];
    return counts.map(c => ({
      hour: c.hour.slice(11, 16), // "HH:MM"
      fatal: c.fatal,
      error: c.error,
      warning: c.warning,
    }));
  }, [logStats]);
  const latestTPS = tpsData.length > 0 ? tpsData[tpsData.length - 1] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>
      {timeRange !== 'realtime' && (
        <div className="text-xs text-zinc-500 -mt-4">
          Showing {historicalSnapshots.length} historical snapshots ({timeRange})
        </div>
      )}

      {/* Row 1: Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          title="Connections"
          value={conns ? `${conns.active} / ${conns.total}` : '--'}
          subtitle={conns ? `max ${conns.max_connections}` : ''}
          icon={Users}
          color={conns && conns.total / conns.max_connections > 0.8 ? 'red' : 'green'}
        />
        <StatCard
          title="TPS"
          value={latestTPS ? `${latestTPS.commits + latestTPS.rollbacks}` : '--'}
          subtitle={latestTPS ? `${latestTPS.commits} commit / ${latestTPS.rollbacks} rollback` : ''}
          icon={Zap}
          color="purple"
        />
        <StatCard
          title="Cache Hit"
          value={formatPercent(cacheHit)}
          icon={TrendingUp}
          color={cacheColor(cacheHit)}
        />
        <StatCard
          title="DB Size"
          value={formatBytes(totalDbSize)}
          subtitle={`${(latest?.pg?.database_sizes ?? []).length} databases`}
          icon={Database}
          color="blue"
        />
        <StatCard
          title="CPU"
          value={formatPercent(cpuUsage)}
          subtitle={`Load: ${latest?.system?.cpu?.load_avg_1?.toFixed(2) ?? '--'}`}
          icon={Cpu}
          color={cpuUsage > 80 ? 'red' : cpuUsage > 50 ? 'yellow' : 'cyan'}
        />
        <StatCard
          title="Disk I/O"
          value={`${totalReadMBps.toFixed(1)} / ${totalWriteMBps.toFixed(1)}`}
          subtitle="Read / Write MB/s"
          icon={HardDrive}
          color="cyan"
        />
      </div>

      {/* Row 1.5: PG Log Health */}
      {logStats?.available && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <StatCard
            title="Fatal (24h)"
            value={String(logStats.fatal_count ?? 0)}
            icon={AlertTriangle}
            color={(logStats.fatal_count ?? 0) > 0 ? 'red' : 'green'}
          />
          <StatCard
            title="Errors (24h)"
            value={String(logStats.error_count ?? 0)}
            icon={AlertTriangle}
            color={(logStats.error_count ?? 0) > 0 ? 'red' : 'green'}
          />
          <StatCard
            title="Warnings (24h)"
            value={String(logStats.warning_count ?? 0)}
            icon={AlertTriangle}
            color={(logStats.warning_count ?? 0) > 0 ? 'yellow' : 'green'}
          />
          <ChartCard title="Log Severity by Hour (24h)">
            {logChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={logChartData}>
                  <XAxis dataKey="hour" {...AXIS} />
                  <Tooltip {...TT_STYLE} />
                  <Bar dataKey="fatal" name="Fatal" fill="#dc2626" stackId="1" />
                  <Bar dataKey="error" name="Errors" fill="#ef4444" stackId="1" />
                  <Bar dataKey="warning" name="Warnings" fill="#eab308" stackId="1" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-4">No log data yet</p>
            )}
          </ChartCard>
        </div>
      )}

      {/* Row 2: TPS + Connection States */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Transactions per Second">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={tpsData}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="time" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TT_STYLE} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
              <Line type="monotone" dataKey="commits" name="Commits" stroke="#22c55e" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="rollbacks" name="Rollbacks" stroke="#ef4444" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Connection States">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="time" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TT_STYLE} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
              <Area type="monotone" dataKey="active" name="Active" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} stackId="1" />
              <Area type="monotone" dataKey="idle" name="Idle" stroke="#6b7280" fill="#6b7280" fillOpacity={0.2} stackId="1" />
              <Area type="monotone" dataKey="idle_tx" name="Idle in Tx" stroke="#eab308" fill="#eab308" fillOpacity={0.3} stackId="1" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 3: CPU + Disk I/O */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="CPU Usage">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="time" {...AXIS} />
              <YAxis {...AXIS} domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <Tooltip {...TT_STYLE} formatter={(v: number | undefined) => `${(v ?? 0).toFixed(1)}%`} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
              <Area type="monotone" dataKey="cpu_user" name="User" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} stackId="1" />
              <Area type="monotone" dataKey="cpu_system" name="System" stroke="#a855f7" fill="#a855f7" fillOpacity={0.3} stackId="1" />
              <Area type="monotone" dataKey="cpu_iowait" name="IO Wait" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} stackId="1" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Disk I/O Throughput">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="time" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={v => `${v.toFixed(0)}`} />
              <Tooltip {...TT_STYLE} formatter={(v: number | undefined) => `${(v ?? 0).toFixed(2)} MB/s`} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
              <Line type="monotone" dataKey="read_mbps" name="Read MB/s" stroke="#22c55e" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="write_mbps" name="Write MB/s" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 4: Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TableCard title="Long Running Queries">
          {longRunning.length === 0 ? (
            <p className="text-sm text-zinc-500 p-3">No long-running queries</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">PID</th>
                  <th className="p-2">Duration</th>
                  <th className="p-2">User</th>
                  <th className="p-2">Query</th>
                </tr>
              </thead>
              <tbody>
                {longRunning.map((q, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono text-zinc-400">{String(q.pid)}</td>
                    <td className="p-2 text-yellow-400 font-mono">
                      {Number(q.duration_seconds).toFixed(1)}s
                    </td>
                    <td className="p-2 text-zinc-400">{String(q.usename)}</td>
                    <td className="p-2 text-zinc-300 truncate max-w-[300px]" title={String(q.query)}>
                      {String(q.query).slice(0, 80)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>

        <TableCard title="Top Queries by Total Time">
          {topQueries.length === 0 ? (
            <p className="text-sm text-zinc-500 p-3">pg_stat_statements not available</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Calls</th>
                  <th className="p-2">Total (ms)</th>
                  <th className="p-2">Mean (ms)</th>
                  <th className="p-2">Query</th>
                </tr>
              </thead>
              <tbody>
                {topQueries.map((q, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono text-zinc-400">{String(q.calls)}</td>
                    <td className="p-2 font-mono text-orange-400">
                      {Number(q.total_exec_time).toFixed(1)}
                    </td>
                    <td className="p-2 font-mono text-zinc-400">
                      {Number(q.mean_exec_time).toFixed(2)}
                    </td>
                    <td className="p-2 text-zinc-300 truncate max-w-[300px]" title={String(q.query)}>
                      {String(q.query).slice(0, 80)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </div>
    </div>
  );
}

// ── sub-components ──

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-400">{title}</h3>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

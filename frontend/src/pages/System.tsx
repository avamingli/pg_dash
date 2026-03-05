import { useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import { Cpu, MemoryStick, HardDrive, Network, Server } from 'lucide-react';
import { useMetrics } from '@/contexts/MetricsContext';
import { formatBytes, formatPercent } from '@/lib/utils';
import StatCard from '@/components/StatCard';

// ── chart theme (matches Overview) ──

const GRID = { stroke: '#27272a', strokeDasharray: '3 3' };
const AXIS = { stroke: '#3f3f46', fontSize: 11, tick: { fill: '#71717a' } };
const TT_STYLE = { contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }, labelStyle: { color: '#a1a1aa' } };

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sliceHistory<T>(arr: T[], maxLen: number) {
  return arr.length > maxLen ? arr.slice(arr.length - maxLen) : arr;
}

// ── component ──

export default function System() {
  const { latest, history } = useMetrics();

  const cpu = latest?.system?.cpu;
  const mem = latest?.system?.memory;
  const disks = latest?.system?.disks ?? [];
  const diskIO = latest?.system?.disk_io ?? [];
  const nets = latest?.system?.network ?? [];
  const procs = latest?.system?.processes ?? [];

  // ── CPU chart data ──
  const cpuChartData = useMemo(() => {
    return sliceHistory(history, 150).map(s => ({
      time: fmtTime(s.timestamp),
      user: s.system?.cpu?.user ?? 0,
      system: s.system?.cpu?.system ?? 0,
      iowait: s.system?.cpu?.iowait ?? 0,
      steal: s.system?.cpu?.steal ?? 0,
    }));
  }, [history]);

  // ── Per-core data ──
  const perCoreData = useMemo(() => {
    return (cpu?.per_core ?? []).map((pct, i) => ({ name: `${i}`, usage: pct }));
  }, [cpu]);

  // ── Memory chart data ──
  const memChartData = useMemo(() => {
    return sliceHistory(history, 150).map(s => {
      const m = s.system?.memory;
      return {
        time: fmtTime(s.timestamp),
        used: m ? (m.used - m.buffers - m.cached) / 1024 / 1024 / 1024 : 0,
        buffers: m ? m.buffers / 1024 / 1024 / 1024 : 0,
        cached: m ? m.cached / 1024 / 1024 / 1024 : 0,
        free: m ? m.free / 1024 / 1024 / 1024 : 0,
      };
    });
  }, [history]);

  // ── Disk I/O chart data ──
  const diskIOChartData = useMemo(() => {
    return sliceHistory(history, 150).map(s => {
      const ios = s.system?.disk_io ?? [];
      return {
        time: fmtTime(s.timestamp),
        read_mbps: ios.reduce((a, d) => a + d.read_bps, 0) / 1024 / 1024,
        write_mbps: ios.reduce((a, d) => a + d.write_bps, 0) / 1024 / 1024,
        read_iops: ios.reduce((a, d) => a + d.read_iops, 0),
        write_iops: ios.reduce((a, d) => a + d.write_iops, 0),
      };
    });
  }, [history]);

  // ── Network chart data ──
  const netChartData = useMemo(() => {
    return sliceHistory(history, 150).map(s => {
      const n = s.system?.network ?? [];
      return {
        time: fmtTime(s.timestamp),
        recv_mbps: n.reduce((a, d) => a + d.recv_bps, 0) / 1024 / 1024,
        send_mbps: n.reduce((a, d) => a + d.send_bps, 0) / 1024 / 1024,
      };
    });
  }, [history]);

  // ── PG process totals ──
  const pgMemTotal = procs.reduce((a, p) => a + p.mem_rss, 0);
  const pgCpuTotal = procs.reduce((a, p) => a + p.cpu_percent, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">System</h1>

      {/* ── Section 1: CPU ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-300 flex items-center gap-2"><Cpu size={18} /> CPU</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="CPU Usage" value={formatPercent(cpu?.usage_percent ?? 0)} icon={Cpu}
            color={((cpu?.usage_percent ?? 0) > 80) ? 'red' : ((cpu?.usage_percent ?? 0) > 50) ? 'yellow' : 'cyan'} />
          <StatCard title="Load 1m" value={(cpu?.load_avg_1 ?? 0).toFixed(2)}
            subtitle={`5m: ${(cpu?.load_avg_5 ?? 0).toFixed(2)} / 15m: ${(cpu?.load_avg_15 ?? 0).toFixed(2)}`}
            icon={Cpu} color="blue" />
          <StatCard title="IO Wait" value={formatPercent(cpu?.iowait ?? 0)} icon={Cpu}
            color={((cpu?.iowait ?? 0) > 20) ? 'red' : ((cpu?.iowait ?? 0) > 5) ? 'yellow' : 'green'} />
          <StatCard title="Cores" value={String(cpu?.num_cpus ?? '--')} icon={Cpu} color="purple" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="CPU Usage Over Time">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={cpuChartData}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="time" {...AXIS} />
                <YAxis {...AXIS} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                <Area type="monotone" dataKey="user" name="User" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} stackId="1" />
                <Area type="monotone" dataKey="system" name="System" stroke="#a855f7" fill="#a855f7" fillOpacity={0.3} stackId="1" />
                <Area type="monotone" dataKey="iowait" name="IO Wait" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} stackId="1" />
                <Area type="monotone" dataKey="steal" name="Steal" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} stackId="1" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Per-Core CPU Usage">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={perCoreData} layout="vertical">
                <CartesianGrid {...GRID} />
                <XAxis type="number" {...AXIS} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" {...AXIS} width={30} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Bar dataKey="usage" name="Usage" radius={[0, 4, 4, 0]}>
                  {perCoreData.map((entry, i) => (
                    <Cell key={i} fill={entry.usage > 80 ? '#ef4444' : entry.usage > 50 ? '#f59e0b' : '#3b82f6'} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </section>

      {/* ── Section 2: Memory ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-300 flex items-center gap-2"><MemoryStick size={18} /> Memory</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Used" value={formatPercent(mem?.used_percent ?? 0)}
            subtitle={mem ? `${formatBytes(mem.used)} / ${formatBytes(mem.total)}` : ''}
            icon={MemoryStick} color={((mem?.used_percent ?? 0) > 80) ? 'red' : ((mem?.used_percent ?? 0) > 60) ? 'yellow' : 'green'} />
          <StatCard title="Available" value={mem ? formatBytes(mem.available) : '--'} icon={MemoryStick} color="blue" />
          <StatCard title="Cached" value={mem ? formatBytes(mem.cached) : '--'}
            subtitle={mem ? `Buffers: ${formatBytes(mem.buffers)}` : ''} icon={MemoryStick} color="cyan" />
          <StatCard title="Swap" value={mem ? formatBytes(mem.swap_used) : '--'}
            subtitle={mem && mem.swap_total > 0 ? `${formatPercent(mem.swap_used / mem.swap_total * 100)} of ${formatBytes(mem.swap_total)}` : 'No swap'}
            icon={MemoryStick} color={mem && mem.swap_used > 0 ? 'yellow' : 'green'} />
        </div>

        {/* Memory breakdown bar */}
        {mem && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <p className="text-sm text-zinc-400 mb-2">Memory Breakdown</p>
            <div className="h-6 rounded-full overflow-hidden flex bg-zinc-800">
              <div className="bg-red-500/70 h-full" style={{ width: `${((mem.used - mem.buffers - mem.cached) / mem.total) * 100}%` }}
                title={`Used: ${formatBytes(mem.used - mem.buffers - mem.cached)}`} />
              <div className="bg-blue-500/70 h-full" style={{ width: `${(mem.buffers / mem.total) * 100}%` }}
                title={`Buffers: ${formatBytes(mem.buffers)}`} />
              <div className="bg-cyan-500/70 h-full" style={{ width: `${(mem.cached / mem.total) * 100}%` }}
                title={`Cached: ${formatBytes(mem.cached)}`} />
              <div className="bg-zinc-700 h-full flex-1" title={`Free: ${formatBytes(mem.free)}`} />
            </div>
            <div className="flex gap-4 mt-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/70 inline-block" /> Used</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500/70 inline-block" /> Buffers</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-cyan-500/70 inline-block" /> Cached</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-zinc-700 inline-block" /> Free</span>
            </div>
          </div>
        )}

        <ChartCard title="Memory Usage Over Time (GB)">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={memChartData}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="time" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={v => `${v.toFixed(0)}G`} />
              <Tooltip {...TT_STYLE} formatter={(v: number) => `${v.toFixed(2)} GB`} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
              <Area type="monotone" dataKey="used" name="Used" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} stackId="1" />
              <Area type="monotone" dataKey="buffers" name="Buffers" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} stackId="1" />
              <Area type="monotone" dataKey="cached" name="Cached" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.3} stackId="1" />
              <Area type="monotone" dataKey="free" name="Free" stroke="#6b7280" fill="#6b7280" fillOpacity={0.2} stackId="1" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* ── Section 3: Disk ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-300 flex items-center gap-2"><HardDrive size={18} /> Disk</h2>

        {/* Per-mount-point usage */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <p className="text-sm text-zinc-400">Mount Points</p>
          {disks.map(d => (
            <div key={d.mount_point}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-300 font-mono">
                  {d.mount_point}
                  {d.is_pgdata && <span className="ml-2 text-xs text-blue-400 font-sans">(PGDATA)</span>}
                  <span className="ml-2 text-zinc-600">{d.device} · {d.fstype}</span>
                </span>
                <span className={d.used_percent > 90 ? 'text-red-400' : d.used_percent > 80 ? 'text-yellow-400' : 'text-zinc-400'}>
                  {formatBytes(d.used)} / {formatBytes(d.total)} ({formatPercent(d.used_percent)})
                </span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-zinc-800">
                <div className={`h-full rounded-full ${d.used_percent > 90 ? 'bg-red-500' : d.used_percent > 80 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                  style={{ width: `${d.used_percent}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Disk I/O Throughput">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={diskIOChartData}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="time" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={v => `${v.toFixed(0)}`} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => `${v.toFixed(2)} MB/s`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                <Line type="monotone" dataKey="read_mbps" name="Read MB/s" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="write_mbps" name="Write MB/s" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Disk IOPS">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={diskIOChartData}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="time" {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip {...TT_STYLE} formatter={(v: number) => `${v.toFixed(0)} IOPS`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                <Line type="monotone" dataKey="read_iops" name="Read IOPS" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="write_iops" name="Write IOPS" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Current disk I/O per device */}
        {diskIO.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <p className="text-sm text-zinc-400">Disk I/O per Device</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                    <th className="p-2">Device</th>
                    <th className="p-2">Read/s</th>
                    <th className="p-2">Write/s</th>
                    <th className="p-2">Read IOPS</th>
                    <th className="p-2">Write IOPS</th>
                    <th className="p-2">In Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {diskIO.filter(d => d.read_bps > 0 || d.write_bps > 0 || d.iops_in_progress > 0 || d.read_iops > 0 || d.write_iops > 0).map(d => (
                    <tr key={d.device} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="p-2 font-mono text-zinc-300">{d.device}</td>
                      <td className="p-2 font-mono text-green-400">{formatBytes(d.read_bps)}/s</td>
                      <td className="p-2 font-mono text-yellow-400">{formatBytes(d.write_bps)}/s</td>
                      <td className="p-2 font-mono text-zinc-400">{d.read_iops.toFixed(0)}</td>
                      <td className="p-2 font-mono text-zinc-400">{d.write_iops.toFixed(0)}</td>
                      <td className="p-2 font-mono text-zinc-400">{d.iops_in_progress}</td>
                    </tr>
                  ))}
                  {diskIO.filter(d => d.read_bps > 0 || d.write_bps > 0 || d.iops_in_progress > 0 || d.read_iops > 0 || d.write_iops > 0).length === 0 && (
                    <tr><td colSpan={6} className="p-4 text-center text-zinc-500">No active disk I/O</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Section 4: Network ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-300 flex items-center gap-2"><Network size={18} /> Network</h2>

        <ChartCard title="Network Throughput">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={netChartData}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="time" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={v => `${v.toFixed(0)}`} />
              <Tooltip {...TT_STYLE} formatter={(v: number) => `${v.toFixed(2)} MB/s`} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
              <Line type="monotone" dataKey="recv_mbps" name="Recv MB/s" stroke="#22c55e" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="send_mbps" name="Send MB/s" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Per-interface table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <p className="text-sm text-zinc-400">Per-Interface Stats</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Interface</th>
                  <th className="p-2">Recv/s</th>
                  <th className="p-2">Send/s</th>
                  <th className="p-2">Total Recv</th>
                  <th className="p-2">Total Send</th>
                  <th className="p-2">Errors</th>
                  <th className="p-2">Drops</th>
                </tr>
              </thead>
              <tbody>
                {nets.map(n => (
                  <tr key={n.interface} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono text-zinc-300">{n.interface}</td>
                    <td className="p-2 font-mono text-green-400">{formatBytes(n.recv_bps)}/s</td>
                    <td className="p-2 font-mono text-blue-400">{formatBytes(n.send_bps)}/s</td>
                    <td className="p-2 font-mono text-zinc-400">{formatBytes(n.bytes_recv)}</td>
                    <td className="p-2 font-mono text-zinc-400">{formatBytes(n.bytes_sent)}</td>
                    <td className={`p-2 font-mono ${(n.errin + n.errout) > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                      {n.errin + n.errout}
                    </td>
                    <td className={`p-2 font-mono ${(n.dropin + n.dropout) > 0 ? 'text-yellow-400' : 'text-zinc-600'}`}>
                      {n.dropin + n.dropout}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Section 5: PostgreSQL Processes ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-300 flex items-center gap-2"><Server size={18} /> PostgreSQL Processes</h2>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard title="PG Processes" value={String(procs.length)} icon={Server} color="blue" />
          <StatCard title="PG CPU Total" value={formatPercent(pgCpuTotal)} icon={Cpu} color="purple" />
          <StatCard title="PG Memory" value={formatBytes(pgMemTotal)} icon={MemoryStick} color="cyan" />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <p className="text-sm text-zinc-400">Process Tree</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">PID</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">CPU%</th>
                  <th className="p-2">MEM%</th>
                  <th className="p-2">RSS</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">FDs</th>
                  <th className="p-2">Threads</th>
                </tr>
              </thead>
              <tbody>
                {procs.map(p => (
                  <tr key={p.pid} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 font-mono text-zinc-400">{p.pid}</td>
                    <td className="p-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        p.type === 'postmaster' ? 'bg-blue-500/20 text-blue-400' :
                        p.type === 'backend' ? 'bg-green-500/20 text-green-400' :
                        p.type === 'autovacuum worker' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-zinc-700 text-zinc-400'
                      }`}>
                        {p.type}
                      </span>
                    </td>
                    <td className={`p-2 font-mono ${p.cpu_percent > 50 ? 'text-red-400' : p.cpu_percent > 10 ? 'text-yellow-400' : 'text-zinc-400'}`}>
                      {p.cpu_percent.toFixed(1)}
                    </td>
                    <td className="p-2 font-mono text-zinc-400">{p.mem_percent.toFixed(1)}</td>
                    <td className="p-2 font-mono text-zinc-400">{formatBytes(p.mem_rss)}</td>
                    <td className="p-2 text-zinc-500">{p.status}</td>
                    <td className="p-2 font-mono text-zinc-500">{p.num_fds}</td>
                    <td className="p-2 font-mono text-zinc-500">{p.num_threads}</td>
                  </tr>
                ))}
                {procs.length === 0 && (
                  <tr><td colSpan={8} className="p-4 text-center text-zinc-500">No PostgreSQL processes found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── sub-component ──

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

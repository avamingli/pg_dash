import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { HardDrive, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useMetrics } from '@/contexts/MetricsContext';
import { formatBytes } from '@/lib/utils';
import type { DatabaseStats, DiskUsage } from '@/types/metrics';

const TT_STYLE = {
  contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
};

export default function Storage() {
  const { latest } = useMetrics();
  const [databases, setDatabases] = useState<DatabaseStats[]>([]);

  function fetchDBs() {
    api.getDatabases().then(setDatabases).catch(() => {});
  }

  useEffect(() => {
    fetchDBs();
    const id = setInterval(fetchDBs, 30_000);
    return () => clearInterval(id);
  }, []);

  const disks: DiskUsage[] = latest?.system?.disks ?? [];

  // Sort databases by size desc for chart
  const dbChartData = useMemo(() =>
    [...databases]
      .sort((a, b) => b.size - a.size)
      .map(d => ({ name: d.datname, size: d.size, sizeMB: d.size / 1024 / 1024 })),
    [databases]
  );

  const totalDbSize = databases.reduce((a, d) => a + d.size, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Storage</h1>
        <button onClick={fetchDBs} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total DB Size"
          value={formatBytes(totalDbSize)}
          sub={`${databases.length} databases`}
        />
        <SummaryCard
          label="Disks"
          value={String(disks.length)}
          sub="mount points"
        />
        {disks.find(d => d.is_pgdata) && (() => {
          const pg = disks.find(d => d.is_pgdata)!;
          return (
            <SummaryCard
              label="PGDATA Disk"
              value={`${pg.used_percent.toFixed(1)}%`}
              sub={`${formatBytes(pg.free)} free of ${formatBytes(pg.total)}`}
              highlight={pg.used_percent > 80}
            />
          );
        })()}
        <SummaryCard
          label="Largest DB"
          value={databases.length > 0 ? databases.sort((a, b) => b.size - a.size)[0].datname : '--'}
          sub={databases.length > 0 ? formatBytes(databases.sort((a, b) => b.size - a.size)[0].size) : ''}
        />
      </div>

      {/* Disk usage per mount point */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Disk Usage by Mount Point</h3>
        <div className="space-y-3">
          {disks.map((d, i) => (
            <div key={i} className={`rounded-lg p-4 ${d.is_pgdata ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-zinc-800/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HardDrive size={14} className={d.is_pgdata ? 'text-blue-400' : 'text-zinc-500'} />
                  <span className="text-sm font-mono text-zinc-200">{d.mount_point}</span>
                  {d.is_pgdata && <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-400">PGDATA</span>}
                  <span className="text-xs text-zinc-500">{d.device} ({d.fstype})</span>
                </div>
                <span className={`text-sm font-mono ${d.used_percent > 90 ? 'text-red-400' : d.used_percent > 80 ? 'text-yellow-400' : 'text-zinc-300'}`}>
                  {d.used_percent.toFixed(1)}%
                </span>
              </div>
              <div className="w-full h-3 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${d.used_percent > 90 ? 'bg-red-500' : d.used_percent > 80 ? 'bg-yellow-500' : d.is_pgdata ? 'bg-blue-500' : 'bg-zinc-400'}`}
                  style={{ width: `${Math.min(d.used_percent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-zinc-500">
                <span>Used: {formatBytes(d.used)}</span>
                <span>Free: {formatBytes(d.free)}</span>
                <span>Total: {formatBytes(d.total)}</span>
              </div>
            </div>
          ))}
          {disks.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-4">No disk data available</p>
          )}
        </div>
      </div>

      {/* Database sizes chart */}
      {dbChartData.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Database Sizes</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, dbChartData.length * 36)}>
            <BarChart data={dbChartData} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke="#3f3f46" fontSize={11} tick={{ fill: '#71717a' }} tickFormatter={v => formatBytes(v)} />
              <YAxis type="category" dataKey="name" stroke="#3f3f46" fontSize={11} tick={{ fill: '#a1a1aa' }} width={75} />
              <Tooltip {...TT_STYLE} formatter={(v: number) => formatBytes(v)} />
              <Bar dataKey="size" name="Size" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Database size table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-400">Database Details</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
              <th className="p-3">Database</th>
              <th className="p-3">Size</th>
              <th className="p-3">% of Total</th>
              <th className="p-3">Connections</th>
              <th className="p-3">Cache Hit</th>
              <th className="p-3">Temp Files</th>
            </tr>
          </thead>
          <tbody>
            {[...databases].sort((a, b) => b.size - a.size).map(db => (
              <tr key={db.datname} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="p-3 text-zinc-200 font-medium">{db.datname}</td>
                <td className="p-3 font-mono text-zinc-300">{formatBytes(db.size)}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${totalDbSize > 0 ? (db.size / totalDbSize * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs font-mono text-zinc-400">{totalDbSize > 0 ? (db.size / totalDbSize * 100).toFixed(1) : '0'}%</span>
                  </div>
                </td>
                <td className="p-3 font-mono text-zinc-400">{db.numbackends}</td>
                <td className="p-3 font-mono text-zinc-400">{db.cache_hit_ratio.toFixed(1)}%</td>
                <td className="p-3 font-mono text-zinc-400">{db.temp_files}</td>
              </tr>
            ))}
            {databases.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-zinc-500">Loading...</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`bg-zinc-900 border rounded-lg p-4 ${highlight ? 'border-yellow-500/50' : 'border-zinc-800'}`}>
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${highlight ? 'text-yellow-400' : 'text-zinc-100'}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>
    </div>
  );
}

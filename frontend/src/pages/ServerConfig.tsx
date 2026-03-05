import { useEffect, useState, useMemo } from 'react';
import { Settings, Search, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { useMetrics } from '@/contexts/MetricsContext';
import type { PGConfigEntry } from '@/types/metrics';
import { formatBytes } from '@/lib/utils';

// ── helpers ──

// Parse PG memory setting to bytes for comparison
function parseMemSetting(value: string, unit: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  switch (unit) {
    case 'kB': return num * 1024;
    case 'MB': return num * 1024 * 1024;
    case 'GB': return num * 1024 * 1024 * 1024;
    case '8kB': return num * 8 * 1024;
    case '16MB': return num * 16 * 1024 * 1024;
    default: return num;
  }
}

interface Recommendation {
  level: 'warning' | 'info';
  setting: string;
  message: string;
}

function computeRecommendations(settings: PGConfigEntry[], totalRAM: number): Recommendation[] {
  const recs: Recommendation[] = [];
  const lookup = Object.fromEntries(settings.map(s => [s.name, s]));

  // shared_buffers < 25% of RAM
  const sb = lookup['shared_buffers'];
  if (sb && totalRAM > 0) {
    const sbBytes = parseMemSetting(sb.setting, sb.unit);
    if (sbBytes < totalRAM * 0.25) {
      recs.push({
        level: 'warning', setting: 'shared_buffers',
        message: `shared_buffers (${formatBytes(sbBytes)}) is less than 25% of total RAM (${formatBytes(totalRAM)}). Consider increasing to ~${formatBytes(totalRAM * 0.25)}.`,
      });
    }
  }

  // effective_cache_size < 50% of RAM
  const ecs = lookup['effective_cache_size'];
  if (ecs && totalRAM > 0) {
    const ecsBytes = parseMemSetting(ecs.setting, ecs.unit);
    if (ecsBytes < totalRAM * 0.5) {
      recs.push({
        level: 'warning', setting: 'effective_cache_size',
        message: `effective_cache_size (${formatBytes(ecsBytes)}) is less than 50% of total RAM (${formatBytes(totalRAM)}). Consider ~${formatBytes(totalRAM * 0.75)}.`,
      });
    }
  }

  // random_page_cost = 4 when likely using SSDs
  const rpc = lookup['random_page_cost'];
  if (rpc && parseFloat(rpc.setting) >= 4) {
    recs.push({
      level: 'info', setting: 'random_page_cost',
      message: `random_page_cost is ${rpc.setting}. If using SSDs, consider setting to 1.1-1.5 for better index usage.`,
    });
  }

  // wal_level = minimal with replication slots check
  const wl = lookup['wal_level'];
  if (wl && wl.setting === 'minimal') {
    recs.push({
      level: 'warning', setting: 'wal_level',
      message: 'wal_level is set to minimal. Replication and point-in-time recovery are not possible.',
    });
  }

  // max_connections high + work_mem warning
  const mc = lookup['max_connections'];
  const wm = lookup['work_mem'];
  if (mc && wm) {
    const maxConns = parseInt(mc.setting);
    const wmBytes = parseMemSetting(wm.setting, wm.unit);
    if (maxConns > 200 && wmBytes > 64 * 1024 * 1024) {
      recs.push({
        level: 'warning', setting: 'work_mem',
        message: `work_mem (${formatBytes(wmBytes)}) with max_connections (${maxConns}) could consume up to ${formatBytes(wmBytes * maxConns)} in worst case.`,
      });
    }
  }

  // pending_restart
  const pending = settings.filter(s => s.pending_restart);
  if (pending.length > 0) {
    recs.push({
      level: 'warning', setting: 'pending_restart',
      message: `${pending.length} setting(s) changed but require restart: ${pending.map(s => s.name).join(', ')}`,
    });
  }

  return recs;
}

// ── component ──

export default function ServerConfig() {
  const { latest } = useMetrics();
  const [settings, setSettings] = useState<PGConfigEntry[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  function fetchConfig() {
    api.getServerConfig().then(setSettings).catch(() => {});
  }

  useEffect(() => { fetchConfig(); }, []);

  const totalRAM = latest?.system?.memory?.total ?? 0;

  // Categories
  const categories = useMemo(() => {
    const cats = [...new Set(settings.map(s => s.category))].sort();
    return cats;
  }, [settings]);

  // Group + filter
  const grouped = useMemo(() => {
    let list = settings;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.setting.toLowerCase().includes(q) ||
        s.short_desc.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }
    if (categoryFilter) {
      list = list.filter(s => s.category === categoryFilter);
    }

    const groups: Record<string, PGConfigEntry[]> = {};
    for (const s of list) {
      (groups[s.category] ??= []).push(s);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [settings, search, categoryFilter]);

  const recommendations = useMemo(() => computeRecommendations(settings, totalRAM), [settings, totalRAM]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Server Configuration</h1>
          <Settings size={20} className="text-zinc-500" />
        </div>
        <button onClick={fetchConfig} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${
              rec.level === 'warning' ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-blue-500/5 border-blue-500/20'
            }`}>
              {rec.level === 'warning'
                ? <AlertTriangle className="text-yellow-400 shrink-0 mt-0.5" size={16} />
                : <Info className="text-blue-400 shrink-0 mt-0.5" size={16} />}
              <div>
                <span className="text-xs font-mono text-zinc-400">{rec.setting}</span>
                <p className="text-sm text-zinc-300 mt-0.5">{rec.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          <input type="text" placeholder="Search settings..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded pl-8 pr-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 max-w-[250px]">
          <option value="">All Categories ({settings.length})</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(search || categoryFilter) && (
          <button onClick={() => { setSearch(''); setCategoryFilter(''); }} className="text-xs text-zinc-400 hover:text-white">Clear</button>
        )}
      </div>

      {/* Settings grouped by category */}
      {grouped.map(([category, entries]) => (
        <div key={category} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
            <h3 className="text-sm font-medium text-zinc-400">{category} <span className="text-zinc-600">({entries.length})</span></h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="p-2">Setting</th>
                  <th className="p-2">Value</th>
                  <th className="p-2">Unit</th>
                  <th className="p-2">Default</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(s => {
                  const isNonDefault = s.setting !== s.boot_val;
                  const isPending = s.pending_restart;
                  return (
                    <tr key={s.name} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${isPending ? 'border-l-2 border-l-red-500' : ''}`}>
                      <td className="p-2">
                        <span className="font-mono text-zinc-200">{s.name}</span>
                        {isPending && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 uppercase">
                            Restart Required
                          </span>
                        )}
                      </td>
                      <td className={`p-2 font-mono ${isNonDefault ? 'text-blue-400' : 'text-zinc-300'}`}>
                        {s.setting}
                      </td>
                      <td className="p-2 text-zinc-500 text-xs">{s.unit || '--'}</td>
                      <td className="p-2 font-mono text-zinc-500 text-xs">{s.boot_val}</td>
                      <td className="p-2 text-xs">
                        <span className={`px-1.5 py-0.5 rounded ${
                          s.source === 'default' ? 'bg-zinc-800 text-zinc-500' :
                          s.source === 'configuration file' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-purple-500/10 text-purple-400'
                        }`}>{s.source}</span>
                      </td>
                      <td className="p-2 text-xs text-zinc-500 max-w-[300px] truncate" title={s.short_desc}>
                        {s.short_desc}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {grouped.length === 0 && (
        <p className="text-sm text-zinc-500 text-center py-8">No settings match your search</p>
      )}
    </div>
  );
}

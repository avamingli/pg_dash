import { useState, useEffect, useMemo } from 'react';
import { Stethoscope, AlertTriangle, AlertCircle, Info, Play, Loader2, Check } from 'lucide-react';
import { api } from '@/lib/api';
import type { ScanResult, Recommendation } from '@/types/metrics';
import { formatBytes } from '@/lib/utils';
import StatCard from '@/components/StatCard';

const CATEGORIES = ['all', 'xid_age', 'dead_tuples', 'stale_stats', 'unused_index', 'duplicate_index', 'index_bloat', 'skew'] as const;

function severityIcon(sev: string) {
  switch (sev) {
    case 'critical': return <AlertTriangle size={14} className="text-red-500" />;
    case 'warning': return <AlertCircle size={14} className="text-yellow-500" />;
    default: return <Info size={14} className="text-blue-400" />;
  }
}

function severityBg(sev: string) {
  switch (sev) {
    case 'critical': return 'bg-red-500/10 border-red-500/30';
    case 'warning': return 'bg-yellow-500/10 border-yellow-500/30';
    default: return 'bg-blue-500/10 border-blue-500/30';
  }
}

export default function Recommendations() {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [executing, setExecuting] = useState<string | null>(null);
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getRecommendations().then(setResult).catch(() => {});
  }, []);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const r = await api.triggerScan();
      setResult(r);
      setExecuted(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  const handleAction = async (rec: Recommendation) => {
    const key = `${rec.category}:${rec.schema}.${rec.table}`;
    if (!confirm(`Execute: ${rec.action_sql}?`)) return;
    setExecuting(key);
    try {
      await api.executeAction(rec.action_sql);
      setExecuted(prev => new Set(prev).add(key));
    } catch (e) {
      alert(`Failed: ${e}`);
    } finally {
      setExecuting(null);
    }
  };

  const filtered = useMemo(() => {
    if (!result) return [];
    if (category === 'all') return result.recommendations;
    return result.recommendations.filter(r => r.category === category);
  }, [result, category]);

  const summary = result?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Stethoscope size={24} className="text-emerald-400" />
          <h1 className="text-2xl font-bold">Recommendations</h1>
        </div>
        <div className="flex items-center gap-4">
          {result?.scanned_at && (
            <span className="text-xs text-zinc-500">
              Last scan: {new Date(result.scanned_at).toLocaleString()} ({result.duration_ms}ms)
            </span>
          )}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {scanning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {scanning ? 'Scanning...' : 'Run Scan'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Critical"
          value={String(summary?.critical ?? 0)}
          icon={AlertTriangle}
          color={(summary?.critical ?? 0) > 0 ? 'red' : 'green'}
        />
        <StatCard
          title="Warning"
          value={String(summary?.warning ?? 0)}
          icon={AlertCircle}
          color={(summary?.warning ?? 0) > 0 ? 'yellow' : 'green'}
        />
        <StatCard
          title="Info"
          value={String(summary?.info ?? 0)}
          icon={Info}
          color="blue"
        />
        <StatCard
          title="Total"
          value={String(summary?.total ?? 0)}
          icon={Stethoscope}
          color="purple"
        />
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              category === cat
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {cat === 'all' ? 'All' : cat.replace(/_/g, ' ')}
            {cat !== 'all' && summary?.by_category?.[cat]
              ? ` (${summary.by_category[cat]})`
              : ''}
          </button>
        ))}
      </div>

      {/* Results Table */}
      {!result ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
          Click "Run Scan" to analyze your database health
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
          No recommendations found{category !== 'all' ? ` for ${category}` : ''}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                <th className="p-3">Severity</th>
                <th className="p-3">Category</th>
                <th className="p-3">Object</th>
                <th className="p-3">Current Value</th>
                <th className="p-3">Message</th>
                <th className="p-3">Size</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec, i) => {
                const key = `${rec.category}:${rec.schema}.${rec.table}`;
                const isDone = executed.has(key);
                const isRunning = executing === key;
                return (
                  <tr key={i} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${severityBg(rec.severity)} border`}>
                    <td className="p-3">{severityIcon(rec.severity)}</td>
                    <td className="p-3 text-zinc-400 font-mono text-xs">{rec.category}</td>
                    <td className="p-3 font-mono text-zinc-300 text-xs">
                      {rec.database ? `${rec.database}.` : ''}
                      {rec.schema ? `${rec.schema}.` : ''}{rec.table}
                    </td>
                    <td className="p-3 text-zinc-400 text-xs">{rec.current_value}</td>
                    <td className="p-3 text-zinc-300 text-xs max-w-[300px]">{rec.message}</td>
                    <td className="p-3 text-zinc-400 text-xs font-mono">
                      {rec.size_bytes > 0 ? formatBytes(rec.size_bytes) : '-'}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => handleAction(rec)}
                        disabled={isRunning || isDone}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
                        title={rec.action_sql}
                      >
                        {isDone ? <Check size={12} className="text-green-400" /> :
                         isRunning ? <Loader2 size={12} className="animate-spin" /> :
                         <Play size={12} />}
                        {rec.action}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

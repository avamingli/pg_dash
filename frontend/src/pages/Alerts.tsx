import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Bell, RefreshCw, AlertTriangle, Info, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { AlertEntry } from '@/types/metrics';

type SeverityFilter = '' | 'info' | 'warning' | 'critical';

const SEVERITY_COLORS: Record<string, string> = {
  info: '#3b82f6',
  warning: '#eab308',
  critical: '#ef4444',
};

const SEVERITY_ICONS: Record<string, React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  critical: XCircle,
};

const TT_STYLE = {
  contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
};

export default function Alerts() {
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [filter, setFilter] = useState<SeverityFilter>('');
  const [showResolved, setShowResolved] = useState(true);

  function fetchAlerts() {
    api.getAlerts().then(setAlerts).catch(() => {});
  }

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 5000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    let list = alerts;
    if (filter) list = list.filter(a => a.severity === filter);
    if (!showResolved) list = list.filter(a => !a.resolved);
    return list;
  }, [alerts, filter, showResolved]);

  // Counts by severity
  const activeCount = alerts.filter(a => !a.resolved).length;
  const criticalCount = alerts.filter(a => a.severity === 'critical' && !a.resolved).length;
  const warningCount = alerts.filter(a => a.severity === 'warning' && !a.resolved).length;
  const infoCount = alerts.filter(a => a.severity === 'info' && !a.resolved).length;

  // Alert history chart — group by 10-min buckets
  const historyChart = useMemo(() => {
    if (alerts.length === 0) return [];
    const buckets: Record<string, { time: string; critical: number; warning: number; info: number }> = {};
    for (const a of alerts) {
      const d = new Date(a.timestamp);
      d.setMinutes(Math.floor(d.getMinutes() / 10) * 10, 0, 0);
      const key = d.toISOString();
      if (!buckets[key]) {
        buckets[key] = {
          time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          critical: 0, warning: 0, info: 0,
        };
      }
      buckets[key][a.severity]++;
    }
    return Object.values(buckets).sort((a, b) => a.time.localeCompare(b.time));
  }, [alerts]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Alerts</h1>
          <Bell size={20} className="text-zinc-500" />
          {activeCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
              {activeCount} active
            </span>
          )}
        </div>
        <button onClick={fetchAlerts} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Active" value={activeCount} color={activeCount > 0 ? 'text-red-400 bg-red-400/10' : 'text-zinc-400 bg-zinc-400/10'} />
        <SummaryCard label="Critical" value={criticalCount} color={criticalCount > 0 ? 'text-red-400 bg-red-400/10' : 'text-zinc-400 bg-zinc-400/10'} />
        <SummaryCard label="Warning" value={warningCount} color={warningCount > 0 ? 'text-yellow-400 bg-yellow-400/10' : 'text-zinc-400 bg-zinc-400/10'} />
        <SummaryCard label="Info" value={infoCount} color="text-blue-400 bg-blue-400/10" />
      </div>

      {/* Alert history chart */}
      {historyChart.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Alert History</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={historyChart}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#3f3f46" fontSize={11} tick={{ fill: '#71717a' }} />
              <YAxis stroke="#3f3f46" fontSize={11} tick={{ fill: '#71717a' }} allowDecimals={false} />
              <Tooltip {...TT_STYLE} />
              <Bar dataKey="critical" name="Critical" stackId="1" fill="#ef4444" />
              <Bar dataKey="warning" name="Warning" stackId="1" fill="#eab308" />
              <Bar dataKey="info" name="Info" stackId="1" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
        <div className="flex gap-1">
          {(['', 'critical', 'warning', 'info'] as SeverityFilter[]).map(sev => (
            <button key={sev} onClick={() => setFilter(sev)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                filter === sev ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}>
              {sev || 'All'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 ml-auto cursor-pointer">
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-blue-500" />
          Show resolved
        </label>
        <span className="text-xs text-zinc-500">{filtered.length} alerts</span>
      </div>

      {/* Alert list */}
      <div className="space-y-2">
        {filtered.map(a => {
          const Icon = SEVERITY_ICONS[a.severity] || Info;
          const color = SEVERITY_COLORS[a.severity] || '#71717a';
          return (
            <div key={a.id} className={`bg-zinc-900 border rounded-lg p-4 flex items-start gap-3 ${
              a.resolved ? 'border-zinc-800 opacity-60' : `border-l-2`
            }`} style={a.resolved ? {} : { borderLeftColor: color }}>
              <div className="p-1.5 rounded-lg shrink-0" style={{ backgroundColor: `${color}15` }}>
                <Icon size={16} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: `${color}20`, color }}>
                    {a.severity}
                  </span>
                  <span className="text-xs text-zinc-500">{a.rule_name}</span>
                  {a.resolved && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Resolved</span>
                  )}
                </div>
                <p className="text-sm text-zinc-200">{a.message}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                  <span>{new Date(a.timestamp).toLocaleString()}</span>
                  {a.resolved && a.resolved_at && (
                    <span>Resolved at {new Date(a.resolved_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
            <Bell size={24} className="text-zinc-600 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">No alerts to display</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Bell size={18} />
      </div>
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-semibold text-zinc-100 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

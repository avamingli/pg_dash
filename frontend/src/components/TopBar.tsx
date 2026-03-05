import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useMetrics } from '@/contexts/MetricsContext';
import type { ServerInfo } from '@/types/metrics';

export default function TopBar() {
  const { connected, latest } = useMetrics();
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    api.getServerInfo()
      .then(setServerInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const fetch = () => api.getAlertCount().then(d => setAlertCount(d.count)).catch(() => {});
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, []);

  // Extract short version: "PostgreSQL 19devel" from full version string
  const shortVersion = serverInfo?.version
    ? serverInfo.version.split(' on ')[0]
    : '';

  // Format uptime from PG interval string
  const uptime = serverInfo?.uptime ?? '';

  // Connection counts from latest metrics
  const conns = latest?.pg?.connections;

  return (
    <header className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
      {/* Left: connection status + server version */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-2.5 h-2.5 rounded-full transition-colors',
              connected ? 'bg-green-500' : 'bg-red-500'
            )}
          />
          <span className="text-sm text-zinc-400">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {shortVersion && (
          <span className="text-sm text-zinc-500 hidden sm:inline">
            {shortVersion}
          </span>
        )}

        {uptime && (
          <span className="text-xs text-zinc-600 hidden md:inline">
            up {uptime}
          </span>
        )}
      </div>

      {/* Center: database name */}
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Database size={14} className="text-zinc-500" />
        <span>postgres</span>
      </div>

      {/* Right: alerts + connection gauge */}
      <div className="flex items-center gap-4">
        <Link to="/alerts" className="relative text-zinc-400 hover:text-white transition-colors">
          <Bell size={18} />
          {alertCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </Link>
        {conns && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Connections:</span>
            <span className={cn(
              'font-mono',
              conns.total / conns.max_connections > 0.8 ? 'text-red-400' :
              conns.total / conns.max_connections > 0.5 ? 'text-yellow-400' : 'text-green-400'
            )}>
              {conns.total}
            </span>
            <span className="text-zinc-600">/ {conns.max_connections}</span>
          </div>
        )}
      </div>
    </header>
  );
}

import { cn } from '@/lib/utils';
import { useMetrics } from '@/contexts/MetricsContext';

export default function StatusBar() {
  const { latest, connected } = useMetrics();

  const lastRefresh = latest?.timestamp
    ? new Date(latest.timestamp).toLocaleTimeString()
    : '--:--:--';

  const conns = latest?.pg?.connections;
  const cpu = latest?.system?.cpu;

  return (
    <footer className="h-7 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between px-4 text-xs text-zinc-500 shrink-0">
      {/* Left: WS status + last refresh */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              connected ? 'bg-green-500' : 'bg-red-500'
            )}
          />
          <span>WS {connected ? 'live' : 'off'}</span>
        </div>
        <span>Last refresh: {lastRefresh}</span>
      </div>

      {/* Right: quick stats */}
      <div className="flex items-center gap-4">
        {conns && (
          <span>
            Active: {conns.active} | Idle: {conns.idle} | IdleTx: {conns.idle_in_transaction}
          </span>
        )}
        {cpu && (
          <span>CPU: {cpu.usage_percent.toFixed(1)}%</span>
        )}
      </div>
    </footer>
  );
}

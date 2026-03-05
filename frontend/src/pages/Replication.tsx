import { useEffect, useState } from 'react';
import { GitBranch, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBytes, formatNumber } from '@/lib/utils';
import type { WALResponse } from '@/types/metrics';

type Row = Record<string, unknown>;

export default function Replication() {
  const [status, setStatus] = useState<Row[]>([]);
  const [slots, setSlots] = useState<Row[]>([]);
  const [wal, setWal] = useState<WALResponse | null>(null);

  function fetchAll() {
    api.getReplicationStatus().then(setStatus).catch(() => setStatus([]));
    api.getReplicationSlots().then(setSlots).catch(() => setSlots([]));
    api.getWALStats().then(setWal).catch(() => setWal(null));
  }

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Replication</h1>
          <GitBranch size={20} className="text-zinc-500" />
        </div>
        <button onClick={fetchAll} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* WAL Stats */}
      {wal && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBox label="Current LSN" value={wal.current_lsn} />
          <StatBox label="Recovery Mode" value={wal.is_recovery ? 'Yes (Standby)' : 'No (Primary)'} color={wal.is_recovery ? 'text-yellow-400' : 'text-green-400'} />
          <StatBox label="WAL Records" value={formatNumber(Number(wal.stats?.wal_records ?? 0))} />
          <StatBox label="WAL Bytes" value={formatBytes(Number(wal.stats?.wal_bytes ?? 0))} />
          <StatBox label="WAL FPI" value={formatNumber(Number(wal.stats?.wal_fpi ?? 0))} />
          <StatBox label="WAL FPI Bytes" value={formatBytes(Number(wal.stats?.wal_fpi_bytes ?? 0))} />
          <StatBox label="WAL Buffers Full" value={formatNumber(Number(wal.stats?.wal_buffers_full ?? 0))} />
          <StatBox label="Stats Reset" value={wal.stats?.stats_reset ? new Date(String(wal.stats.stats_reset)).toLocaleString() : 'Never'} />
        </div>
      )}

      {/* Replication Status */}
      <TableSection title="Replication Status">
        {status.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                <th className="p-2">PID</th>
                <th className="p-2">Application</th>
                <th className="p-2">Client</th>
                <th className="p-2">State</th>
                <th className="p-2">Sent LSN</th>
                <th className="p-2">Write LSN</th>
                <th className="p-2">Flush LSN</th>
                <th className="p-2">Replay LSN</th>
                <th className="p-2">Write Lag</th>
                <th className="p-2">Flush Lag</th>
                <th className="p-2">Replay Lag</th>
                <th className="p-2">Sync</th>
              </tr>
            </thead>
            <tbody>
              {status.map((r, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="p-2 font-mono text-zinc-400">{String(r.pid)}</td>
                  <td className="p-2 text-zinc-200">{String(r.application_name)}</td>
                  <td className="p-2 text-zinc-400 font-mono text-xs">{String(r.client_addr)}</td>
                  <td className="p-2"><LagBadge state={String(r.state)} /></td>
                  <td className="p-2 font-mono text-xs text-zinc-400">{String(r.sent_lsn)}</td>
                  <td className="p-2 font-mono text-xs text-zinc-400">{String(r.write_lsn)}</td>
                  <td className="p-2 font-mono text-xs text-zinc-400">{String(r.flush_lsn)}</td>
                  <td className="p-2 font-mono text-xs text-zinc-400">{String(r.replay_lsn)}</td>
                  <td className="p-2 font-mono text-xs text-yellow-400">{String(r.write_lag ?? '--')}</td>
                  <td className="p-2 font-mono text-xs text-yellow-400">{String(r.flush_lag ?? '--')}</td>
                  <td className="p-2 font-mono text-xs text-orange-400">{String(r.replay_lag ?? '--')}</td>
                  <td className="p-2 text-xs text-zinc-400">{String(r.sync_state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4 flex items-center gap-2 text-sm text-zinc-500">
            <AlertTriangle size={14} className="text-zinc-600" />
            No active replication connections
          </div>
        )}
      </TableSection>

      {/* Replication Slots */}
      <TableSection title="Replication Slots">
        {slots.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                <th className="p-2">Slot Name</th>
                <th className="p-2">Type</th>
                <th className="p-2">Active</th>
                <th className="p-2">Restart LSN</th>
                <th className="p-2">Confirmed Flush LSN</th>
                <th className="p-2">WAL Status</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="p-2 text-zinc-200 font-medium">{String(s.slot_name)}</td>
                  <td className="p-2 text-zinc-400">{String(s.slot_type)}</td>
                  <td className="p-2">
                    <span className={`inline-flex items-center gap-1 text-xs ${s.active ? 'text-green-400' : 'text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-green-400' : 'bg-red-400'}`} />
                      {s.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs text-zinc-400">{String(s.restart_lsn ?? '--')}</td>
                  <td className="p-2 font-mono text-xs text-zinc-400">{String(s.confirmed_flush_lsn ?? '--')}</td>
                  <td className="p-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded ${
                      String(s.wal_status) === 'reserved' ? 'bg-green-500/20 text-green-400' :
                      String(s.wal_status) === 'lost' ? 'bg-red-500/20 text-red-400' :
                      'bg-zinc-700 text-zinc-400'
                    }`}>{String(s.wal_status ?? '--')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-zinc-500 p-4">No replication slots configured</p>
        )}
      </TableSection>
    </div>
  );
}

function TableSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-400">{title}</h3>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-mono mt-0.5 ${color ?? 'text-zinc-200'}`}>{value}</p>
    </div>
  );
}

function LagBadge({ state }: { state: string }) {
  const color = state === 'streaming' ? 'bg-green-500/20 text-green-400' :
    state === 'catchup' ? 'bg-yellow-500/20 text-yellow-400' :
    'bg-zinc-700 text-zinc-400';
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${color}`}>{state}</span>;
}

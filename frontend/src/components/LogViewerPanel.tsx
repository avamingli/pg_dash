import { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { LogEntry } from '@/types/metrics';

interface LogViewerPanelProps {
  severity?: string;
  onClose: () => void;
}

const severityColors: Record<string, string> = {
  PANIC: 'bg-red-600 text-white',
  FATAL: 'bg-red-500 text-white',
  ERROR: 'bg-red-400/20 text-red-400',
  WARNING: 'bg-yellow-400/20 text-yellow-400',
};

export default function LogViewerPanel({ severity, onClose }: LogViewerPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(() => {
    setLoading(true);
    api.getLogEntries(severity, 200)
      .then(d => setEntries(d ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [severity]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const title = severity ? `${severity} Log Entries` : 'All Log Entries';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-zinc-900 border-l border-zinc-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchEntries}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <p className="text-sm text-zinc-500 p-4">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-zinc-500 p-4">No log entries found.</p>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {entries.map((entry, i) => (
                <div key={i} className="px-4 py-2.5 hover:bg-zinc-800/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${severityColors[entry.severity] ?? 'bg-zinc-700 text-zinc-300'}`}>
                      {entry.severity}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {entry.timestamp}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                    {entry.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">
          {entries.length} entries
        </div>
      </div>
    </div>
  );
}

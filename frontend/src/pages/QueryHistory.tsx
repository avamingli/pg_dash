import { useState, useEffect, useCallback } from 'react';
import { History, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import type { QueryHistoryEntry, QueryHistoryResponse } from '@/types/metrics';
import { formatBytes } from '@/lib/utils';

function formatDuration(ms: number) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString([], {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function QueryHistory() {
  const [data, setData] = useState<QueryHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Filter state
  const [username, setUsername] = useState('');
  const [database, setDatabase] = useState('');
  const [queryText, setQueryText] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [orderBy, setOrderBy] = useState('submitted_at');
  const [orderDir, setOrderDir] = useState('desc');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        order_by: orderBy,
        order_dir: orderDir,
        limit: String(limit),
        offset: String(offset),
      };
      if (username) params.username = username;
      if (database) params.database = database;
      if (queryText) params.query_text = queryText;
      if (minDuration) params.min_duration = minDuration;
      const r = await api.getHistory(params);
      setData(r);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [username, database, queryText, minDuration, orderBy, orderDir, limit, offset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (col: string) => {
    if (orderBy === col) {
      setOrderDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setOrderBy(col);
      setOrderDir('desc');
    }
    setOffset(0);
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (orderBy !== col) return null;
    return orderDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />;
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History size={24} className="text-blue-400" />
          <h1 className="text-2xl font-bold">Query History</h1>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-zinc-500">
              {data.total} total entries
            </span>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            <Search size={14} />
            Filters
            {showFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Username</label>
              <input
                value={username}
                onChange={e => { setUsername(e.target.value); setOffset(0); }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                placeholder="Filter by user..."
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Database</label>
              <input
                value={database}
                onChange={e => { setDatabase(e.target.value); setOffset(0); }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                placeholder="Filter by database..."
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Query Text</label>
              <input
                value={queryText}
                onChange={e => { setQueryText(e.target.value); setOffset(0); }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                placeholder="Search query text..."
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Min Duration (ms)</label>
              <input
                type="number"
                value={minDuration}
                onChange={e => { setMinDuration(e.target.value); setOffset(0); }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                placeholder="e.g. 100"
              />
            </div>
          </div>
        </div>
      )}

      {/* Not available message */}
      {data && 'message' in data && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2 text-yellow-400 text-sm">
          {(data as unknown as Record<string, string>).message}
        </div>
      )}

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-center text-zinc-500">Loading...</div>
        ) : !data || data.entries.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">
            No query history found. History will be collected every 60 seconds from pg_stat_statements.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('submitted_at')}>
                      <span className="flex items-center gap-1">Time <SortIcon col="submitted_at" /></span>
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('username')}>
                      <span className="flex items-center gap-1">User <SortIcon col="username" /></span>
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('database')}>
                      <span className="flex items-center gap-1">Database <SortIcon col="database" /></span>
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('duration_ms')}>
                      <span className="flex items-center gap-1">Duration <SortIcon col="duration_ms" /></span>
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('calls')}>
                      <span className="flex items-center gap-1">Calls <SortIcon col="calls" /></span>
                    </th>
                    <th className="p-3">Rows</th>
                    <th className="p-3">Query</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e: QueryHistoryEntry) => (
                    <>
                      <tr
                        key={e.id}
                        className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      >
                        <td className="p-3 text-zinc-400 font-mono text-xs whitespace-nowrap">
                          {formatTime(e.submitted_at)}
                        </td>
                        <td className="p-3 text-zinc-300">{e.username}</td>
                        <td className="p-3 text-zinc-400">{e.database}</td>
                        <td className="p-3 font-mono text-orange-400">{formatDuration(e.duration_ms)}</td>
                        <td className="p-3 font-mono text-zinc-400">{e.calls}</td>
                        <td className="p-3 font-mono text-zinc-400">{e.rows_affected}</td>
                        <td className="p-3 text-zinc-300 truncate max-w-[400px]" title={e.query_text}>
                          {e.query_text.slice(0, 100)}
                        </td>
                      </tr>
                      {expanded === e.id && (
                        <tr key={`${e.id}-detail`} className="border-b border-zinc-800">
                          <td colSpan={7} className="p-4 bg-zinc-800/30">
                            <div className="space-y-3">
                              <div>
                                <span className="text-xs text-zinc-500 block mb-1">Full Query</span>
                                <pre className="bg-zinc-950 border border-zinc-700 rounded p-3 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                                  {e.query_text}
                                </pre>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                <div>
                                  <span className="text-zinc-500">Mean Exec Time</span>
                                  <p className="text-zinc-300 font-mono">{formatDuration(e.mean_exec_time)}</p>
                                </div>
                                <div>
                                  <span className="text-zinc-500">Shared Blks Hit</span>
                                  <p className="text-zinc-300 font-mono">{e.shared_blks_hit.toLocaleString()}</p>
                                </div>
                                <div>
                                  <span className="text-zinc-500">Shared Blks Read</span>
                                  <p className="text-zinc-300 font-mono">{e.shared_blks_read.toLocaleString()}</p>
                                </div>
                                <div>
                                  <span className="text-zinc-500">Temp Blks Written</span>
                                  <p className="text-zinc-300 font-mono">{e.temp_blks_written.toLocaleString()}</p>
                                </div>
                                <div>
                                  <span className="text-zinc-500">WAL Bytes</span>
                                  <p className="text-zinc-300 font-mono">{formatBytes(e.wal_bytes)}</p>
                                </div>
                                <div>
                                  <span className="text-zinc-500">Query ID</span>
                                  <p className="text-zinc-300 font-mono">{e.queryid}</p>
                                </div>
                                <div>
                                  <span className="text-zinc-500">Status</span>
                                  <p className="text-zinc-300">{e.status}</p>
                                </div>
                                {e.ended_at && (
                                  <div>
                                    <span className="text-zinc-500">Ended At</span>
                                    <p className="text-zinc-300 font-mono">{formatTime(e.ended_at)}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
              <span className="text-xs text-zinc-500">
                Showing {offset + 1}–{Math.min(offset + limit, data.total)} of {data.total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-zinc-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= data.total}
                  className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

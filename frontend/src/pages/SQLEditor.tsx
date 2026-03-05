import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Play, FileText, Download, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, Plus, X, Shield, ShieldOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { QueryResult } from '@/types/metrics';

// ── types ──

interface QueryTab {
  id: number;
  name: string;
  sql: string;
}

interface HistoryEntry {
  sql: string;
  timestamp: Date;
  duration?: number;
  error?: string;
  rowCount?: number;
}

const PAGE_SIZE = 50;

export default function SQLEditor() {
  // Tabs
  const [tabs, setTabs] = useState<QueryTab[]>([{ id: 1, name: 'Query 1', sql: '' }]);
  const [activeTabId, setActiveTabId] = useState(1);
  const nextId = useRef(2);

  // State
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [explainResult, setExplainResult] = useState<string | object | null>(null);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [explain, setExplain] = useState(false);
  const [page, setPage] = useState(0);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  function updateSQL(sql: string) {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, sql } : t));
  }

  function addTab() {
    const id = nextId.current++;
    setTabs(prev => [...prev, { id, name: `Query ${id}`, sql: '' }]);
    setActiveTabId(id);
    setResult(null);
    setExplainResult(null);
    setError('');
  }

  function closeTab(id: number) {
    if (tabs.length <= 1) return;
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) setActiveTabId(newTabs[0].id);
  }

  const execute = useCallback(async () => {
    const sql = activeTab.sql.trim();
    if (!sql || running) return;

    setRunning(true);
    setResult(null);
    setExplainResult(null);
    setError('');
    setPage(0);
    const start = performance.now();

    try {
      if (explain) {
        const res = await api.explainQuery(sql, true, true);
        const elapsed = performance.now() - start;
        setExplainResult(res.plan as string | object);
        setDuration(elapsed);
        setHistory(prev => [{ sql, timestamp: new Date(), duration: elapsed }, ...prev].slice(0, 50));
      } else {
        const res = await api.executeQuery(sql, readOnly);
        const elapsed = performance.now() - start;
        setResult(res);
        setDuration(elapsed);
        setHistory(prev => [{ sql, timestamp: new Date(), duration: elapsed, rowCount: res.row_count }, ...prev].slice(0, 50));
      }
    } catch (e) {
      const elapsed = performance.now() - start;
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      setDuration(elapsed);
      setHistory(prev => [{ sql, timestamp: new Date(), duration: elapsed, error: msg }, ...prev].slice(0, 50));
    } finally {
      setRunning(false);
    }
  }, [activeTab.sql, running, explain, readOnly]);

  // Ctrl+Enter
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        execute();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [execute]);

  // CSV export
  function exportCSV() {
    if (!result) return;
    const lines: string[] = [];
    lines.push(result.columns.map(c => `"${c}"`).join(','));
    for (const row of result.rows) {
      lines.push(result.columns.map(c => {
        const v = row[c];
        if (v == null) return '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'query-result.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // Paginated rows
  const pagedRows = result ? result.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];
  const totalPages = result ? Math.ceil(result.rows.length / PAGE_SIZE) : 0;

  return (
    <div className="flex h-full gap-0">
      {/* Main panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar */}
        <div className="flex items-center gap-0 bg-zinc-900 border-b border-zinc-800">
          {tabs.map(t => (
            <div key={t.id}
              className={`flex items-center gap-2 px-3 py-2 text-sm border-r border-zinc-800 cursor-pointer ${
                t.id === activeTabId ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'
              }`}
              onClick={() => { setActiveTabId(t.id); setResult(null); setExplainResult(null); setError(''); }}
            >
              <FileText size={12} />
              <span>{t.name}</span>
              {tabs.length > 1 && (
                <button onClick={e => { e.stopPropagation(); closeTab(t.id); }} className="hover:text-red-400"><X size={12} /></button>
              )}
            </div>
          ))}
          <button onClick={addTab} className="px-2 py-2 text-zinc-500 hover:text-white"><Plus size={14} /></button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
          <button onClick={execute} disabled={running || !activeTab.sql.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-green-600 hover:bg-green-500 text-white font-medium disabled:opacity-50 transition-colors">
            <Play size={14} /> {running ? 'Running...' : 'Execute'}
          </button>
          <span className="text-xs text-zinc-600 ml-1">Ctrl+Enter</span>
          <div className="w-px h-5 bg-zinc-700 mx-1" />

          <button onClick={() => setExplain(!explain)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
              explain ? 'bg-purple-600/30 text-purple-400 border border-purple-500/50' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}>
            EXPLAIN ANALYZE
          </button>

          <button onClick={() => setReadOnly(!readOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
              readOnly ? 'bg-blue-600/20 text-blue-400' : 'bg-orange-600/20 text-orange-400'
            }`}>
            {readOnly ? <Shield size={12} /> : <ShieldOff size={12} />}
            {readOnly ? 'Read Only' : 'Read/Write'}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {duration != null && (
              <span className="text-xs text-zinc-500">
                <Clock size={12} className="inline mr-1" />
                {duration < 1000 ? `${duration.toFixed(0)}ms` : `${(duration / 1000).toFixed(2)}s`}
              </span>
            )}
            <button onClick={() => setShowHistory(!showHistory)}
              className={`text-xs px-2 py-1 rounded ${showHistory ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
              History ({history.length})
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0 flex flex-col">
          <textarea
            ref={textareaRef}
            value={activeTab.sql}
            onChange={e => updateSQL(e.target.value)}
            placeholder="SELECT * FROM pg_stat_activity LIMIT 10;"
            spellCheck={false}
            className="flex-1 min-h-[200px] bg-zinc-950 text-zinc-200 font-mono text-sm p-4 resize-none focus:outline-none border-b border-zinc-800"
            style={{ tabSize: 2 }}
          />

          {/* Results */}
          <div className="flex-1 min-h-[200px] overflow-auto bg-zinc-950">
            {error && (
              <div className="p-4 bg-red-500/10 border-b border-red-500/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                  <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono">{error}</pre>
                </div>
              </div>
            )}

            {explainResult && (
              <div className="p-4">
                <p className="text-xs text-zinc-500 mb-2">Execution Plan (EXPLAIN ANALYZE, BUFFERS, FORMAT JSON):</p>
                <pre className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap max-h-[400px] overflow-auto font-mono">
                  {typeof explainResult === 'string' ? explainResult : JSON.stringify(explainResult as object, null, 2)}
                </pre>
              </div>
            )}

            {result && (
              <div>
                {/* Row count + pagination + export */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
                  <span className="text-xs text-zinc-400">{result.row_count} row{result.row_count !== 1 ? 's' : ''} returned</span>
                  <div className="flex items-center gap-2">
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1 text-xs text-zinc-400">
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                          className="p-0.5 hover:text-white disabled:opacity-30"><ChevronLeft size={14} /></button>
                        <span>{page + 1} / {totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                          className="p-0.5 hover:text-white disabled:opacity-30"><ChevronRight size={14} /></button>
                      </div>
                    )}
                    <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">
                      <Download size={12} /> CSV
                    </button>
                  </div>
                </div>

                {/* Results table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                        <th className="p-2 text-zinc-600 w-8">#</th>
                        {result.columns.map(c => <th key={c} className="p-2 whitespace-nowrap">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.map((row, i) => (
                        <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="p-2 text-zinc-600 text-xs">{page * PAGE_SIZE + i + 1}</td>
                          {result.columns.map(c => (
                            <td key={c} className="p-2 font-mono text-xs text-zinc-300 max-w-[300px] truncate" title={String(row[c] ?? '')}>
                              {row[c] == null ? <span className="text-zinc-600 italic">NULL</span> : String(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!error && !result && !explainResult && !running && (
              <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                Press Ctrl+Enter or click Execute to run query
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History sidebar */}
      {showHistory && (
        <div className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-900 flex flex-col">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-400">Query History</h3>
            <span className="text-xs text-zinc-600">{history.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {history.map((h, i) => (
              <button key={i} onClick={() => { updateSQL(h.sql); textareaRef.current?.focus(); }}
                className="w-full text-left px-3 py-2 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <p className="text-xs font-mono text-zinc-300 truncate">{h.sql.slice(0, 60)}</p>
                <div className="flex items-center gap-2 mt-1 text-xs">
                  <span className="text-zinc-600">{h.timestamp.toLocaleTimeString()}</span>
                  {h.duration != null && <span className="text-zinc-500">{h.duration < 1000 ? `${h.duration.toFixed(0)}ms` : `${(h.duration / 1000).toFixed(1)}s`}</span>}
                  {h.error && <span className="text-red-400">Error</span>}
                  {h.rowCount != null && <span className="text-zinc-500">{h.rowCount} rows</span>}
                </div>
              </button>
            ))}
            {history.length === 0 && (
              <p className="text-xs text-zinc-600 p-3">No queries yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

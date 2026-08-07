import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Play, FileText, Download, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, Plus, X, Shield, ShieldOff, Database, Eye,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useMetrics } from '@/contexts/MetricsContext';
import type { QueryResult } from '@/types/metrics';
import PlanViewer from '@/components/PlanViewer';
import QueryWatchPanel from '@/components/QueryWatchPanel';

// ── types ──

// Each tab owns its own execution state (running/result/error/...) so one
// tab running a slow query doesn't block another tab from running its own —
// they're independent connections on the backend already, the UI just used
// to serialize them behind one shared set of state variables.
interface QueryTab {
  id: number;
  name: string;
  sql: string;
  running: boolean;
  result: QueryResult | null;
  explainResult: string | object | null;
  error: string;
  duration: number | null;
  page: number;
  watchPid: number | null;
  showWatchPanel: boolean;
}

interface HistoryEntry {
  sql: string;
  timestamp: Date;
  duration?: number;
  error?: string;
  rowCount?: number;
}

const PAGE_SIZE = 50;

function newTab(id: number): QueryTab {
  return {
    id, name: `Query ${id}`, sql: '',
    running: false, result: null, explainResult: null, error: '', duration: null,
    page: 0, watchPid: null, showWatchPanel: false,
  };
}

export default function SQLEditor() {
  const { queryMetricsAvailable } = useMetrics();

  // Tabs
  const [tabs, setTabs] = useState<QueryTab[]>([newTab(1)]);
  const [activeTabId, setActiveTabId] = useState(1);
  const nextId = useRef(2);

  // Toolbar toggles — shared across tabs, applied to whichever tab is active
  // when Execute is pressed (captured by value at that point, so flipping a
  // toggle afterward never affects a query already in flight).
  const [readOnly, setReadOnly] = useState(true);
  const [explain, setExplain] = useState(false);

  // Database switcher — '' means the default PG_DSN database
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);

  useEffect(() => {
    api.getDatabases()
      .then(dbs => setDatabases(dbs.map(db => db.datname)))
      .catch(() => {});
  }, []);

  // History (shared across tabs — "what did I run recently, anywhere")
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // One pid-discovery poll timer per tab, keyed by tab id.
  const pidPollRefs = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  function updateTab(id: number, patch: Partial<QueryTab>) {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }

  function updateSQL(sql: string) {
    updateTab(activeTabId, { sql });
  }

  function addTab() {
    const id = nextId.current++;
    setTabs(prev => [...prev, newTab(id)]);
    setActiveTabId(id);
  }

  function closeTab(id: number) {
    if (tabs.length <= 1) return;
    if (pidPollRefs.current[id]) clearInterval(pidPollRefs.current[id]);
    delete pidPollRefs.current[id];
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) setActiveTabId(newTabs[0].id);
  }

  // Poll Activity Monitor's connection list (same data that page already
  // shows) to find the pid this exact SQL just started running as, without
  // making the user navigate over there themselves. Gives up after ~4.5s —
  // fast queries just won't get a Watch shortcut, which is fine, there's
  // nothing to watch by the time we'd find it anyway.
  function startPidDiscovery(tabId: number, sql: string) {
    if (pidPollRefs.current[tabId]) clearInterval(pidPollRefs.current[tabId]);
    updateTab(tabId, { watchPid: null });
    let attempts = 0;
    const poll = () => {
      attempts += 1;
      api.getActivity()
        .then(conns => {
          const match = conns
            .filter(c => c.state === 'active' && c.query.trim() === sql)
            .sort((a, b) => (b.query_start ?? '').localeCompare(a.query_start ?? ''))[0];
          if (match) {
            updateTab(tabId, { watchPid: match.pid });
            clearInterval(pidPollRefs.current[tabId]);
            delete pidPollRefs.current[tabId];
          } else if (attempts >= 15) {
            clearInterval(pidPollRefs.current[tabId]);
            delete pidPollRefs.current[tabId];
          }
        })
        .catch(() => {});
    };
    poll();
    pidPollRefs.current[tabId] = setInterval(poll, 300);
  }

  useEffect(() => {
    return () => {
      Object.values(pidPollRefs.current).forEach(clearInterval);
    };
  }, []);

  const execute = useCallback(async () => {
    const tabId = activeTabId;
    const tab = tabs.find(t => t.id === tabId);
    const sql = tab?.sql.trim() ?? '';
    if (!sql || tab?.running) return;

    updateTab(tabId, { running: true, result: null, explainResult: null, error: '', page: 0 });
    const start = performance.now();

    if (!explain && queryMetricsAvailable) {
      startPidDiscovery(tabId, sql);
    }

    try {
      if (explain) {
        const res = await api.explainQuery(sql, true, true, database || undefined);
        const elapsed = performance.now() - start;
        updateTab(tabId, { explainResult: res.plan as string | object, duration: elapsed });
        setHistory(prev => [{ sql, timestamp: new Date(), duration: elapsed }, ...prev].slice(0, 50));
      } else {
        const res = await api.executeQuery(sql, readOnly, database || undefined);
        const elapsed = performance.now() - start;
        updateTab(tabId, { result: res, duration: elapsed });
        setHistory(prev => [{ sql, timestamp: new Date(), duration: elapsed, rowCount: res.row_count }, ...prev].slice(0, 50));
      }
    } catch (e) {
      const elapsed = performance.now() - start;
      const msg = e instanceof Error ? e.message : 'Unknown error';
      updateTab(tabId, { error: msg, duration: elapsed });
      setHistory(prev => [{ sql, timestamp: new Date(), duration: elapsed, error: msg }, ...prev].slice(0, 50));
    } finally {
      if (pidPollRefs.current[tabId]) {
        clearInterval(pidPollRefs.current[tabId]);
        delete pidPollRefs.current[tabId];
      }
      updateTab(tabId, { running: false, watchPid: null, showWatchPanel: false });
    }
  }, [activeTabId, tabs, explain, readOnly, database, queryMetricsAvailable]);

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
    const result = activeTab.result;
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

  // Paginated rows (of the active tab's result)
  const result = activeTab.result;
  const page = activeTab.page;
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
              onClick={() => setActiveTabId(t.id)}
            >
              <FileText size={12} />
              <span>{t.name}</span>
              {t.running && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Running" />
              )}
              {tabs.length > 1 && (
                <button onClick={e => { e.stopPropagation(); closeTab(t.id); }} className="hover:text-red-400"><X size={12} /></button>
              )}
            </div>
          ))}
          <button onClick={addTab} className="px-2 py-2 text-zinc-500 hover:text-white"><Plus size={14} /></button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
          <button onClick={execute} disabled={activeTab.running || !activeTab.sql.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-green-600 hover:bg-green-500 text-white font-medium disabled:opacity-50 transition-colors">
            <Play size={14} /> {activeTab.running ? 'Running...' : 'Execute'}
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

          <div className="w-px h-5 bg-zinc-700 mx-1" />

          <div className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-300">
            <Database size={12} className="text-zinc-500" />
            <select
              value={database}
              onChange={e => setDatabase(e.target.value)}
              className="bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="">default (PG_DSN)</option>
              {databases.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {activeTab.running && activeTab.watchPid != null && (
              <button onClick={() => updateTab(activeTabId, { showWatchPanel: true })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 transition-colors animate-pulse">
                <Eye size={12} /> Watch (pid {activeTab.watchPid})
              </button>
            )}
            {activeTab.duration != null && (
              <span className="text-xs text-zinc-500">
                <Clock size={12} className="inline mr-1" />
                {activeTab.duration < 1000 ? `${activeTab.duration.toFixed(0)}ms` : `${(activeTab.duration / 1000).toFixed(2)}s`}
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
            {activeTab.error && (
              <div className="p-4 bg-red-500/10 border-b border-red-500/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                  <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono">{activeTab.error}</pre>
                </div>
              </div>
            )}

            {activeTab.explainResult && (
              <PlanViewer plan={activeTab.explainResult} />
            )}

            {result && (
              <div>
                {/* Row count + pagination + export */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
                  <span className="text-xs text-zinc-400">{result.row_count} row{result.row_count !== 1 ? 's' : ''} returned</span>
                  <div className="flex items-center gap-2">
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1 text-xs text-zinc-400">
                        <button onClick={() => updateTab(activeTabId, { page: Math.max(0, page - 1) })} disabled={page === 0}
                          className="p-0.5 hover:text-white disabled:opacity-30"><ChevronLeft size={14} /></button>
                        <span>{page + 1} / {totalPages}</span>
                        <button onClick={() => updateTab(activeTabId, { page: Math.min(totalPages - 1, page + 1) })} disabled={page >= totalPages - 1}
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

            {!activeTab.error && !result && !activeTab.explainResult && !activeTab.running && (
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

      {activeTab.showWatchPanel && activeTab.watchPid != null && (
        <QueryWatchPanel
          pid={activeTab.watchPid}
          sql={activeTab.sql.trim()}
          onClose={() => updateTab(activeTabId, { showWatchPanel: false })}
        />
      )}
    </div>
  );
}

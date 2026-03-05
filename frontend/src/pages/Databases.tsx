import { useEffect, useState, useMemo } from 'react';
import { Database, ArrowLeft, Search, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBytes, formatPercent, formatNumber } from '@/lib/utils';
import type { DatabaseStats } from '@/types/metrics';

// ── types ──

type TableRow = Record<string, unknown>;
type SortDir = 'asc' | 'desc';

// ── helpers ──

function cacheColor(ratio: number): string {
  if (ratio >= 99) return 'text-green-400';
  if (ratio >= 95) return 'text-yellow-400';
  return 'text-red-400';
}

function deadTupleColor(pct: number): string {
  if (pct > 20) return 'bg-red-500/20 text-red-400';
  if (pct > 10) return 'bg-red-500/10 text-red-300';
  return '';
}

// ── component ──

export default function Databases() {
  const [databases, setDatabases] = useState<DatabaseStats[]>([]);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tableSortKey, setTableSortKey] = useState('schemaname');
  const [tableSortDir, setTableSortDir] = useState<SortDir>('asc');
  const [detailTable, setDetailTable] = useState<TableRow | null>(null);
  const [tableIO, setTableIO] = useState<Record<string, unknown> | null>(null);
  const [tableIndexes, setTableIndexes] = useState<TableRow[]>([]);
  const [actionMsg, setActionMsg] = useState('');

  // Fetch databases
  useEffect(() => {
    const fetch = () => api.getDatabases().then(setDatabases).catch(() => {});
    fetch();
    const id = setInterval(fetch, 10_000);
    return () => clearInterval(id);
  }, []);

  // Fetch tables when db selected
  useEffect(() => {
    if (!selectedDb) { setTables([]); return; }
    setTablesLoading(true);
    api.getTables(selectedDb, '%')
      .then(d => setTables(d ?? []))
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));
  }, [selectedDb]);

  // Fetch table detail (IO + indexes)
  useEffect(() => {
    if (!selectedDb || !detailTable) { setTableIO(null); setTableIndexes([]); return; }
    const schema = String(detailTable.schemaname);
    const table = String(detailTable.relname);
    api.getTableIO(selectedDb, table, schema).then(setTableIO).catch(() => setTableIO(null));
    api.getDatabaseIndexes(selectedDb).then(d => {
      setTableIndexes((d ?? []).filter(idx => String(idx.relname) === table && String(idx.schemaname) === schema));
    }).catch(() => setTableIndexes([]));
  }, [selectedDb, detailTable]);

  function handleSort(key: string) {
    if (tableSortKey === key) {
      setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setTableSortKey(key);
      setTableSortDir('asc');
    }
  }

  const filteredTables = useMemo(() => {
    let list = tables;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t =>
        String(t.relname).toLowerCase().includes(q) ||
        String(t.schemaname).toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const va = a[tableSortKey];
      const vb = b[tableSortKey];
      const na = typeof va === 'number' ? va : String(va ?? '').toLowerCase();
      const nb = typeof vb === 'number' ? vb : String(vb ?? '').toLowerCase();
      if (na < nb) return tableSortDir === 'asc' ? -1 : 1;
      if (na > nb) return tableSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tables, searchQuery, tableSortKey, tableSortDir]);

  async function triggerAction(action: 'vacuum' | 'analyze') {
    if (!selectedDb || !detailTable) return;
    const schema = String(detailTable.schemaname);
    const table = String(detailTable.relname);
    try {
      if (action === 'vacuum') await api.triggerVacuum(schema, table);
      else await api.triggerAnalyze(schema, table);
      setActionMsg(`${action.toUpperCase()} completed on ${schema}.${table}`);
      setTimeout(() => setActionMsg(''), 3000);
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : 'unknown'}`);
      setTimeout(() => setActionMsg(''), 5000);
    }
  }

  // ── Database Cards View ──
  if (!selectedDb) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Databases</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {databases.map(db => (
            <button
              key={db.datname}
              onClick={() => setSelectedDb(db.datname)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 text-left hover:border-zinc-600 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-blue-400/10 text-blue-400">
                  <Database size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100 group-hover:text-white">{db.datname}</h3>
                  <p className="text-xs text-zinc-500">{formatBytes(db.size)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-zinc-500">Connections</p>
                  <p className="text-zinc-200 font-mono">{db.numbackends}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Cache Hit</p>
                  <p className={`font-mono ${cacheColor(db.cache_hit_ratio)}`}>
                    {formatPercent(db.cache_hit_ratio)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">TPS</p>
                  <p className="text-zinc-200 font-mono">{formatNumber(db.xact_commit + db.xact_rollback)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs mt-2">
                <div>
                  <p className="text-zinc-500">Deadlocks</p>
                  <p className={`font-mono ${db.deadlocks > 0 ? 'text-red-400' : 'text-zinc-400'}`}>{db.deadlocks}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Temp Files</p>
                  <p className={`font-mono ${db.temp_files > 0 ? 'text-yellow-400' : 'text-zinc-400'}`}>{db.temp_files}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Conflicts</p>
                  <p className={`font-mono ${db.conflicts > 0 ? 'text-orange-400' : 'text-zinc-400'}`}>{db.conflicts}</p>
                </div>
              </div>
            </button>
          ))}
          {databases.length === 0 && (
            <p className="text-sm text-zinc-500 col-span-full">Loading databases...</p>
          )}
        </div>
      </div>
    );
  }

  // ── Tables View ──
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => { setSelectedDb(null); setDetailTable(null); }} className="text-zinc-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold">{selectedDb}</h1>
        <span className="text-sm text-zinc-500">Tables</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          <input
            type="text" placeholder="Search tables..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded pl-8 pr-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <button onClick={() => { setTablesLoading(true); api.getTables(selectedDb, '%').then(d => setTables(d ?? [])).catch(() => {}).finally(() => setTablesLoading(false)); }}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <RefreshCw size={14} /> Refresh
        </button>
        <span className="text-xs text-zinc-500">{filteredTables.length} tables</span>
      </div>

      <div className="flex gap-4">
        {/* Table list */}
        <div className={`bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden ${detailTable ? 'flex-1' : 'w-full'}`}>
          {tablesLoading ? (
            <div className="flex items-center justify-center p-12 text-zinc-500"><Loader2 className="animate-spin" size={20} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
                    {[
                      ['schemaname', 'Schema'], ['relname', 'Table'], ['total_size', 'Total Size'],
                      ['table_size', 'Table Size'], ['indexes_size', 'Index Size'], ['n_live_tup', 'Live Rows'],
                      ['n_dead_tup', 'Dead Rows'], ['dead_tuple_ratio', 'Dead %'],
                      ['seq_scan', 'Seq Scans'], ['idx_scan', 'Idx Scans'],
                      ['last_autovacuum', 'Last Vacuum'], ['last_autoanalyze', 'Last Analyze'],
                    ].map(([key, label]) => (
                      <th key={key} className="p-2 cursor-pointer hover:text-zinc-300 whitespace-nowrap select-none" onClick={() => handleSort(key)}>
                        {label}{tableSortKey === key && <span className="ml-1">{tableSortDir === 'asc' ? '↑' : '↓'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTables.map((t, i) => {
                    const deadPct = Number(t.dead_tuple_ratio ?? 0) * 100;
                    const isSelected = detailTable && String(detailTable.relname) === String(t.relname) && String(detailTable.schemaname) === String(t.schemaname);
                    return (
                      <tr key={i} onClick={() => setDetailTable(t)}
                        className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer ${isSelected ? 'bg-zinc-800/50' : ''}`}>
                        <td className="p-2 text-zinc-500">{String(t.schemaname)}</td>
                        <td className="p-2 text-zinc-200 font-medium">{String(t.relname)}</td>
                        <td className="p-2 font-mono text-zinc-400">{formatBytes(Number(t.total_size ?? 0))}</td>
                        <td className="p-2 font-mono text-zinc-400">{formatBytes(Number(t.table_size ?? 0))}</td>
                        <td className="p-2 font-mono text-zinc-400">{formatBytes(Number(t.indexes_size ?? 0))}</td>
                        <td className="p-2 font-mono text-zinc-300">{formatNumber(Number(t.n_live_tup ?? 0))}</td>
                        <td className="p-2 font-mono text-zinc-400">{formatNumber(Number(t.n_dead_tup ?? 0))}</td>
                        <td className={`p-2 font-mono ${deadTupleColor(deadPct)}`}>{deadPct.toFixed(1)}%</td>
                        <td className="p-2 font-mono text-zinc-400">{formatNumber(Number(t.seq_scan ?? 0))}</td>
                        <td className="p-2 font-mono text-zinc-400">{formatNumber(Number(t.idx_scan ?? 0))}</td>
                        <td className="p-2 text-xs text-zinc-500">{t.last_autovacuum ? new Date(String(t.last_autovacuum)).toLocaleString() : 'Never'}</td>
                        <td className="p-2 text-xs text-zinc-500">{t.last_autoanalyze ? new Date(String(t.last_autoanalyze)).toLocaleString() : 'Never'}</td>
                      </tr>
                    );
                  })}
                  {filteredTables.length === 0 && (
                    <tr><td colSpan={12} className="p-6 text-center text-zinc-500">No tables found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {detailTable && (
          <div className="w-96 shrink-0 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-200">
                {String(detailTable.schemaname)}.{String(detailTable.relname)}
              </h3>
              <button onClick={() => setDetailTable(null)} className="text-zinc-500 hover:text-white text-xs">Close</button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Total Size" value={formatBytes(Number(detailTable.total_size ?? 0))} />
                <Stat label="Live Rows" value={formatNumber(Number(detailTable.n_live_tup ?? 0))} />
                <Stat label="Dead Rows" value={formatNumber(Number(detailTable.n_dead_tup ?? 0))} />
                <Stat label="Seq Scans" value={formatNumber(Number(detailTable.seq_scan ?? 0))} />
                <Stat label="Idx Scans" value={formatNumber(Number(detailTable.idx_scan ?? 0))} />
                <Stat label="Inserts" value={formatNumber(Number(detailTable.n_tup_ins ?? 0))} />
                <Stat label="Updates" value={formatNumber(Number(detailTable.n_tup_upd ?? 0))} />
                <Stat label="Deletes" value={formatNumber(Number(detailTable.n_tup_del ?? 0))} />
              </div>

              {/* I/O Stats */}
              {tableIO && (
                <div>
                  <h4 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">I/O Stats</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Stat label="Heap Blks Read" value={formatNumber(Number(tableIO.heap_blks_read ?? 0))} />
                    <Stat label="Heap Blks Hit" value={formatNumber(Number(tableIO.heap_blks_hit ?? 0))} />
                    <Stat label="Idx Blks Read" value={formatNumber(Number(tableIO.idx_blks_read ?? 0))} />
                    <Stat label="Idx Blks Hit" value={formatNumber(Number(tableIO.idx_blks_hit ?? 0))} />
                    <Stat label="Toast Blks Read" value={formatNumber(Number(tableIO.toast_blks_read ?? 0))} />
                    <Stat label="Toast Blks Hit" value={formatNumber(Number(tableIO.toast_blks_hit ?? 0))} />
                  </div>
                </div>
              )}

              {/* Indexes */}
              <div>
                <h4 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
                  Indexes ({tableIndexes.length})
                </h4>
                {tableIndexes.length > 0 ? (
                  <div className="space-y-1">
                    {tableIndexes.map((idx, i) => (
                      <div key={i} className="bg-zinc-800/50 rounded p-2 text-xs">
                        <p className="text-zinc-200 font-mono">{String(idx.indexrelname)}</p>
                        <p className="text-zinc-500 mt-0.5">
                          Size: {formatBytes(Number(idx.size ?? 0))} | Scans: {formatNumber(Number(idx.idx_scan ?? 0))}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">No indexes</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button onClick={() => triggerAction('vacuum')} className="flex-1 px-3 py-1.5 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 transition-colors">
                  VACUUM
                </button>
                <button onClick={() => triggerAction('analyze')} className="flex-1 px-3 py-1.5 text-xs rounded bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 transition-colors">
                  ANALYZE
                </button>
              </div>
              {actionMsg && <p className="text-xs text-green-400">{actionMsg}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-800/40 rounded p-2">
      <p className="text-zinc-500">{label}</p>
      <p className="text-zinc-200 font-mono mt-0.5">{value}</p>
    </div>
  );
}

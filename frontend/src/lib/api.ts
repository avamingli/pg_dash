import type {
  ServerInfo,
  PGConfigEntry,
  ActivityConnection,
  ActivitySummary,
  DatabaseStats,
  QueryResult,
  CheckpointStatsResponse,
  WALResponse,
  MetricsSnapshot,
  AlertEntry,
  AlertRule,
  LogStats,
  LogEntry,
  ClusterInfo,
  SegmentInfo,
  ClusterHealth,
  SegmentReplication,
  ConfigHistoryEntry,
  ResourceQueueStatus,
  ResourceGroupStatus,
  PerSegmentStats,
  WorkfileUsage,
  ScanResult,
  QueryHistoryResponse,
} from '@/types/metrics';

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  baseUrl: BASE_URL,

  // Health
  getHealth: () => request<{ status: string }>('/api/health'),

  // Server
  getServerInfo: () => request<ServerInfo>('/api/server/info'),
  getServerConfig: () => request<PGConfigEntry[]>('/api/server/config'),

  // Activity
  getActivity: () => request<ActivityConnection[]>('/api/activity'),
  getActivitySummary: () => request<ActivitySummary>('/api/activity/summary'),
  getLongRunning: (threshold = '5 seconds') =>
    request<Record<string, unknown>[]>(`/api/activity/long-running?threshold=${encodeURIComponent(threshold)}`),
  getBlocked: () => request<Record<string, unknown>[]>('/api/activity/blocked'),
  cancelBackend: (pid: number) =>
    request<{ success: boolean; pid: number }>(`/api/activity/${pid}/cancel`, { method: 'POST' }),
  terminateBackend: (pid: number) =>
    request<{ success: boolean; pid: number }>(`/api/activity/${pid}/terminate`, { method: 'POST' }),

  // Databases
  getDatabases: () => request<DatabaseStats[]>('/api/databases'),
  getTables: (db: string, schema = '%') =>
    request<Record<string, unknown>[]>(`/api/databases/${db}/tables?schema=${encodeURIComponent(schema)}`),
  getTableIO: (db: string, table: string, schema = 'public') =>
    request<Record<string, unknown>>(`/api/databases/${db}/tables/${table}/io?schema=${schema}`),
  getTableColumns: (db: string, table: string, schema = 'public') =>
    request<Record<string, unknown>[]>(`/api/databases/${db}/tables/${table}/columns?schema=${schema}`),
  getTableDDL: (db: string, table: string, schema = 'public') =>
    request<Record<string, unknown>>(`/api/databases/${db}/tables/${table}/ddl?schema=${schema}`),
  getTableBloat: (db: string) =>
    request<Record<string, unknown>[]>(`/api/databases/${db}/tables/bloat`),
  getTableDistribution: (schema: string, table: string) =>
    request<Record<string, unknown>>(`/api/cluster/tables/${schema}/${table}/distribution`),
  getDatabaseIndexes: (db: string) =>
    request<Record<string, unknown>[]>(`/api/databases/${db}/indexes`),

  // Indexes
  getIndexes: () => request<Record<string, unknown>[]>('/api/indexes'),
  getUnusedIndexes: () => request<Record<string, unknown>[]>('/api/indexes/unused'),
  getDuplicateIndexes: () => request<Record<string, unknown>[]>('/api/indexes/duplicate'),
  getIndexBloat: () => request<Record<string, unknown>[]>('/api/indexes/bloat'),

  // Queries / Statements
  getTopQueries: (by = 'time', limit = 20) =>
    request<Record<string, unknown>[]>(`/api/queries/top?by=${by}&limit=${limit}`),
  executeQuery: (sql: string, readOnly = true) =>
    request<QueryResult>('/api/query/execute', {
      method: 'POST',
      body: JSON.stringify({ sql, read_only: readOnly }),
    }),
  explainQuery: (sql: string, analyze = false, buffers = false) =>
    request<{ plan: unknown; sql: string }>('/api/query/explain', {
      method: 'POST',
      body: JSON.stringify({ sql, analyze, buffers }),
    }),
  resetStatements: () =>
    request<{ status: string }>('/api/statements/reset', { method: 'POST' }),

  // Locks
  getLocks: () =>
    request<{ locks: Record<string, unknown>[]; summary: Record<string, unknown>[] }>('/api/locks'),
  getLockConflicts: () =>
    request<{ conflicts: Record<string, unknown>[]; blocking_chains: Record<string, unknown>[] }>('/api/locks/conflicts'),

  // Replication
  getReplicationStatus: () => request<Record<string, unknown>[]>('/api/replication/status'),
  getReplicationSlots: () => request<Record<string, unknown>[]>('/api/replication/slots'),
  getWALStats: () => request<WALResponse>('/api/replication/wal'),

  // Vacuum
  getVacuumProgress: () => request<Record<string, unknown>[]>('/api/vacuum/progress'),
  getVacuumWorkers: () => request<Record<string, unknown>[]>('/api/vacuum/workers'),
  getVacuumNeeded: () =>
    request<{ tables: Record<string, unknown>[]; settings: Record<string, unknown>[] }>('/api/vacuum/needed'),
  triggerVacuum: (schema: string, table: string) =>
    request<{ status: string }>(`/api/vacuum/${schema}/${table}`, { method: 'POST' }),
  triggerAnalyze: (schema: string, table: string) =>
    request<{ status: string }>(`/api/vacuum/${schema}/${table}/analyze`, { method: 'POST' }),

  // System (from aggregator)
  getSystemCPU: () => request<Record<string, unknown>>('/api/system/cpu'),
  getSystemMemory: () => request<Record<string, unknown>>('/api/system/memory'),
  getSystemDisk: () => request<Record<string, unknown>[]>('/api/system/disk'),
  getSystemDiskIO: () => request<Record<string, unknown>[]>('/api/system/disk/io'),
  getSystemNetwork: () => request<Record<string, unknown>[]>('/api/system/network'),
  getSystemProcesses: () => request<Record<string, unknown>[]>('/api/system/processes'),

  // Metrics (aggregator history)
  getMetricsLatest: () => request<MetricsSnapshot>('/api/metrics/latest'),
  getMetricsHistory: (duration = '5m') =>
    request<MetricsSnapshot[]>(`/api/metrics/history?duration=${duration}`),

  // Checkpoint
  getCheckpointStats: () => request<CheckpointStatsResponse>('/api/checkpoint/stats'),

  // Logs
  getLogStats: () => request<LogStats>('/api/logs/stats'),
  getLogEntries: (severity?: string, limit = 200) => {
    const params = new URLSearchParams();
    if (severity) params.set('severity', severity);
    params.set('limit', String(limit));
    return request<LogEntry[]>(`/api/logs/entries?${params}`);
  },

  // Cluster (Cloudberry / CBDB)
  getClusterInfo: () => request<ClusterInfo>('/api/cluster/info'),
  getClusterTopology: () => request<SegmentInfo[]>('/api/cluster/topology'),
  getClusterHealth: () => request<ClusterHealth>('/api/cluster/health'),
  getClusterReplication: () => request<SegmentReplication[]>('/api/cluster/replication'),
  getClusterHistory: (limit = 50) =>
    request<ConfigHistoryEntry[]>(`/api/cluster/history?limit=${limit}`),
  getSegmentStats: () => request<PerSegmentStats[]>('/api/cluster/segments/stats'),
  getSegmentDisk: () => request<Record<string, unknown>[]>('/api/cluster/segments/disk'),
  getResourceQueues: () => request<ResourceQueueStatus[]>('/api/cluster/resource/queues'),
  getResourceGroups: () => request<ResourceGroupStatus[]>('/api/cluster/resource/groups'),
  getResourceGroupConfig: () => request<Record<string, unknown>[]>('/api/cluster/resource/config'),
  getWorkfileSegments: () => request<WorkfileUsage[]>('/api/cluster/workfiles/segments'),
  getDataSkew: () => request<Record<string, unknown>[]>('/api/cluster/skew'),
  getConfigDiffs: () => request<Record<string, unknown>[]>('/api/cluster/config-diffs'),
  getHostMetrics: () => request<Record<string, unknown>[]>('/api/cluster/hosts'),

  // Recommendations
  getRecommendations: () => request<ScanResult>('/api/recommendations'),
  triggerScan: () => request<ScanResult>('/api/recommendations/scan', { method: 'POST' }),
  executeAction: (sql: string) =>
    request<{ status: string }>('/api/recommendations/action', {
      method: 'POST',
      body: JSON.stringify({ sql }),
    }),

  // Query History
  getHistory: (params?: Record<string, string>) => {
    const p = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
    }
    return request<QueryHistoryResponse>(`/api/history?${p}`);
  },
  getHistoryStats: () => request<Record<string, unknown>>('/api/history/stats'),

  // Alerts
  getAlerts: () => request<AlertEntry[]>('/api/alerts'),
  getActiveAlerts: () => request<AlertEntry[]>('/api/alerts/active'),
  getAlertCount: () => request<{ count: number }>('/api/alerts/count'),
  getAlertRules: () => request<AlertRule[]>('/api/alerts/rules'),
  setAlertRuleEnabled: (id: string, enabled: boolean) =>
    request<{ status: string }>(`/api/alerts/rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),

  // Snapshots (historical)
  getSnapshots: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<MetricsSnapshot[]>(`/api/snapshots?${params}`);
  },
  compareSnapshots: (t1: string, t2: string) =>
    request<Record<string, unknown>>(`/api/snapshots/compare?t1=${encodeURIComponent(t1)}&t2=${encodeURIComponent(t2)}`),
};

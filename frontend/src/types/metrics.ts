// ── WebSocket snapshot (broadcast every 2s) ──

export interface MetricsSnapshot {
  timestamp: string;
  pg?: PGMetrics;
  system?: OSMetrics;
}

export interface PGMetrics {
  connections?: ConnectionSummary;
  tps?: TPSStats;
  cache_hit_ratio: number;
  database_sizes?: DatabaseSize[];
  log_stats?: LogStats;
}

export interface LogStats {
  available: boolean;
  message?: string;
  fatal_count: number;
  error_count: number;
  warning_count: number;
  panic_count: number;
  hourly_counts?: HourlyLogCount[];
  log_file?: string;
}

export interface HourlyLogCount {
  hour: string;
  fatal: number;
  error: number;
  warning: number;
  panic: number;
}

export interface OSMetrics {
  cpu?: CPUStats;
  memory?: MemoryStats;
  disks?: DiskUsage[];
  disk_io?: DiskIOStats[];
  network?: NetworkStats[];
  processes?: ProcessInfo[];
}

export interface ConnectionSummary {
  total: number;
  active: number;
  idle: number;
  idle_in_transaction: number;
  waiting: number;
  max_connections: number;
}

export interface TPSStats {
  commits: number;
  rollbacks: number;
}

export interface DatabaseSize {
  name: string;
  size: number;
}

// ── CPU ──

export interface CPUStats {
  usage_percent: number;
  user: number;
  system: number;
  idle: number;
  iowait: number;
  steal: number;
  load_avg_1: number;
  load_avg_5: number;
  load_avg_15: number;
  num_cpus: number;
  per_core?: number[];
}

// ── Memory ──

export interface MemoryStats {
  total: number;
  used: number;
  available: number;
  free: number;
  cached: number;
  buffers: number;
  swap_total: number;
  swap_used: number;
  swap_free: number;
  used_percent: number;
}

// ── Disk ──

export interface DiskUsage {
  mount_point: string;
  device: string;
  fstype: string;
  total: number;
  used: number;
  free: number;
  used_percent: number;
  is_pgdata: boolean;
}

export interface DiskIOStats {
  device: string;
  read_bytes: number;
  write_bytes: number;
  read_count: number;
  write_count: number;
  read_time: number;
  write_time: number;
  io_time: number;
  weighted_io_time: number;
  iops_in_progress: number;
  read_bps: number;
  write_bps: number;
  read_iops: number;
  write_iops: number;
}

// ── Network ──

export interface NetworkStats {
  interface: string;
  bytes_sent: number;
  bytes_recv: number;
  packets_sent: number;
  packets_recv: number;
  errin: number;
  errout: number;
  dropin: number;
  dropout: number;
  send_bps: number;
  recv_bps: number;
}

// ── Processes ──

export interface ProcessInfo {
  pid: number;
  name: string;
  type: string;
  cpu_percent: number;
  mem_percent: number;
  mem_rss: number;
  status: string;
  cmdline: string;
  num_fds: number;
  num_threads: number;
}

// ── Server info (from /api/server/info) ──

export interface ServerInfo {
  version: string;
  start_time: string;
  uptime: string;
  max_connections: number;
  settings: ServerSetting[];
}

export interface ServerSetting {
  name: string;
  setting: string;
  unit: string;
}

// ── Server config (from /api/server/config) ──

export interface PGConfigEntry {
  name: string;
  setting: string;
  unit: string;
  category: string;
  short_desc: string;
  source: string;
  boot_val: string;
  reset_val: string;
  pending_restart: boolean;
}

// ── Activity ──

export interface ActivityConnection {
  pid: number;
  usename: string;
  datname: string;
  client_addr: string;
  client_port: number;
  backend_start: string;
  xact_start: string | null;
  query_start: string | null;
  state_change: string | null;
  wait_event_type: string;
  wait_event: string;
  state: string;
  backend_type: string;
  query_id: number;
  query: string;
}

export interface ActivitySummary {
  by_state: { label: string; count: number }[];
  by_database: { label: string; count: number }[];
  by_user: { label: string; count: number }[];
  max_connections: number;
}

// ── Database ──

export interface DatabaseStats {
  datname: string;
  size: number;
  numbackends: number;
  xact_commit: number;
  xact_rollback: number;
  blks_read: number;
  blks_hit: number;
  tup_returned: number;
  tup_fetched: number;
  tup_inserted: number;
  tup_updated: number;
  tup_deleted: number;
  conflicts: number;
  temp_files: number;
  temp_bytes: number;
  deadlocks: number;
  cache_hit_ratio: number;
  stats_reset: string | null;
}

// ── Query execute result ──

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
}

// ── Checkpoint ──

export interface CheckpointStatsResponse {
  checkpointer: Record<string, unknown>;
  bgwriter: Record<string, unknown>;
}

// ── WAL ──

export interface WALResponse {
  stats: Record<string, unknown>;
  current_lsn: string;
  is_recovery: boolean;
}

// ── Alerts ──

export interface AlertEntry {
  id: string;
  rule_name: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
  resolved: boolean;
  resolved_at?: string;
}

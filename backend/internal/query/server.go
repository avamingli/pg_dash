package query

// ServerVersion returns the PostgreSQL version string.
const ServerVersion = `SELECT version()`

// ServerVersionNum returns the numeric server version (e.g. 190000 for PG 19).
const ServerVersionNum = `SHOW server_version_num`

// ServerUptime returns the server start time and uptime as an interval.
const ServerUptime = `
SELECT
    pg_postmaster_start_time() AS start_time,
    now() - pg_postmaster_start_time() AS uptime`

// ServerSettings returns key performance-related settings as name/setting/unit rows.
const ServerSettings = `
SELECT name, setting, COALESCE(unit, '') AS unit
FROM pg_settings
WHERE name IN (
    'shared_buffers', 'work_mem', 'effective_cache_size',
    'max_connections', 'max_wal_size', 'min_wal_size',
    'checkpoint_completion_target',
    'random_page_cost', 'effective_io_concurrency',
    'max_worker_processes', 'max_parallel_workers_per_gather',
    'max_parallel_workers', 'max_parallel_maintenance_workers',
    'wal_level', 'archive_mode',
    'autovacuum', 'autovacuum_max_workers',
    'maintenance_work_mem', 'huge_pages',
    'shared_preload_libraries'
)
ORDER BY name`

// ServerPGConfig returns the full pg_settings view with all metadata.
// Columns: name, setting, unit, category, short_desc, source, boot_val,
// reset_val, pending_restart.
const ServerPGConfig = `
SELECT
    name,
    setting,
    COALESCE(unit, '') AS unit,
    category,
    short_desc,
    source,
    COALESCE(boot_val, '') AS boot_val,
    COALESCE(reset_val, '') AS reset_val,
    pending_restart
FROM pg_settings
ORDER BY category, name`

// MaxConnections returns the current max_connections setting as an integer.
const MaxConnections = `
SELECT setting::int
FROM pg_settings
WHERE name = 'max_connections'`

package query

// VacuumProgress returns progress of currently running vacuum operations.
// Uses pg_stat_progress_vacuum joined with pg_stat_activity and pg_class.
// PG 19 has extra columns: index_vacuum_count, mode, started_by, etc.
const VacuumProgress = `
SELECT
    p.pid,
    COALESCE(a.datname, '') AS datname,
    COALESCE(n.nspname, '') AS schemaname,
    COALESCE(c.relname, '') AS relname,
    p.phase,
    p.heap_blks_total,
    p.heap_blks_scanned,
    p.heap_blks_vacuumed,
    p.index_vacuum_count,
    p.max_dead_tuple_bytes,
    p.dead_tuple_bytes,
    p.num_dead_item_ids,
    COALESCE(p.indexes_total, 0) AS indexes_total,
    COALESCE(p.indexes_processed, 0) AS indexes_processed
FROM pg_stat_progress_vacuum p
JOIN pg_stat_activity a ON p.pid = a.pid
JOIN pg_class c ON p.relid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid`

// AutovacuumWorkers returns currently running autovacuum worker processes.
const AutovacuumWorkers = `
SELECT
    pid,
    COALESCE(datname, '') AS datname,
    COALESCE(query, '') AS query,
    backend_start,
    query_start,
    extract(epoch FROM (now() - query_start))::float8 AS duration_seconds
FROM pg_stat_activity
WHERE backend_type = 'autovacuum worker'
ORDER BY query_start`

// TablesNeedingVacuum returns tables with high dead tuple ratio or that
// haven't been vacuumed recently. Sorted by dead tuple count descending.
const TablesNeedingVacuum = `
SELECT
    schemaname,
    relname,
    n_dead_tup,
    n_live_tup,
    CASE WHEN n_live_tup + n_dead_tup > 0
         THEN round(
             n_dead_tup::numeric /
             (n_live_tup + n_dead_tup) * 100, 2)
         ELSE 0
    END AS dead_tuple_ratio,
    n_mod_since_analyze,
    n_ins_since_vacuum,
    COALESCE(last_vacuum::text, 'never') AS last_vacuum,
    COALESCE(last_autovacuum::text, 'never') AS last_autovacuum,
    COALESCE(last_analyze::text, 'never') AS last_analyze,
    COALESCE(last_autoanalyze::text, 'never') AS last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC`

// AutovacuumSettings returns key autovacuum-related GUCs.
const AutovacuumSettings = `
SELECT name, setting, COALESCE(unit, '') AS unit, short_desc
FROM pg_settings
WHERE name LIKE 'autovacuum%'
ORDER BY name`

// VacuumTable generates a VACUUM command for a specific table.
// NOT a parameterized query — the handler must quote-identify schema.table.
// This constant is used as a template: the handler formats the actual SQL.
const VacuumTable = `VACUUM %s.%s`

// VacuumFullTable generates a VACUUM FULL command for a specific table.
const VacuumFullTable = `VACUUM FULL %s.%s`

// AnalyzeTable generates an ANALYZE command for a specific table.
const AnalyzeTable = `ANALYZE %s.%s`

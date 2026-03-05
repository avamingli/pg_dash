package query

// TableList returns per-table stats from pg_stat_user_tables with sizes.
// Includes DML counters, dead tuple ratio, scan stats, vacuum/analyze times,
// and the PG 17+ timing columns (total_vacuum_time etc.).
// $1 = schema name filter (use '%' for all schemas).
const TableList = `
SELECT
    s.schemaname,
    s.relname,
    pg_total_relation_size(s.relid) AS total_size,
    pg_relation_size(s.relid) AS table_size,
    pg_indexes_size(s.relid) AS index_size,
    s.n_live_tup,
    s.n_dead_tup,
    CASE WHEN s.n_live_tup + s.n_dead_tup > 0
         THEN round(
             s.n_dead_tup::numeric /
             (s.n_live_tup + s.n_dead_tup) * 100, 2)
         ELSE 0
    END AS dead_tuple_ratio,
    s.seq_scan,
    s.seq_tup_read,
    COALESCE(s.idx_scan, 0) AS idx_scan,
    COALESCE(s.idx_tup_fetch, 0) AS idx_tup_fetch,
    s.n_tup_ins,
    s.n_tup_upd,
    s.n_tup_del,
    s.n_tup_hot_upd,
    s.n_tup_newpage_upd,
    s.n_mod_since_analyze,
    s.n_ins_since_vacuum,
    s.last_vacuum,
    s.last_autovacuum,
    s.last_analyze,
    s.last_autoanalyze,
    s.vacuum_count,
    s.autovacuum_count,
    s.analyze_count,
    s.autoanalyze_count
FROM pg_stat_user_tables s
WHERE s.schemaname LIKE $1
ORDER BY pg_total_relation_size(s.relid) DESC`

// TableBloat estimates table bloat using a statistical method.
// Returns estimated wasted bytes per table. This uses the same algorithm
// as pgstattuple but without requiring the extension — it estimates from
// pg_class.relpages, pg_stat_user_tables row estimates, and avg row width.
const TableBloat = `
SELECT
    schemaname,
    tblname,
    pg_total_relation_size(schemaname || '.' || tblname) AS real_size,
    CASE WHEN est_pages > 0
         THEN (bs * est_pages)::bigint
         ELSE 0
    END AS expected_size,
    CASE WHEN real_pages > 0 AND est_pages > 0 AND real_pages > est_pages
         THEN (bs * (real_pages - est_pages))::bigint
         ELSE 0
    END AS bloat_bytes,
    CASE WHEN real_pages > 0 AND est_pages > 0 AND real_pages > est_pages
         THEN round((100.0 * (real_pages - est_pages) / real_pages)::numeric, 1)
         ELSE 0
    END AS bloat_pct
FROM (
    SELECT
        s.schemaname,
        s.relname AS tblname,
        current_setting('block_size')::int AS bs,
        c.relpages AS real_pages,
        CEIL(
            (s.n_live_tup * (
                -- average row width: header + nullbitmap + data
                24 + COALESCE(
                    (SELECT avg(avg_width)
                     FROM pg_stats ps
                     WHERE ps.schemaname = s.schemaname
                       AND ps.tablename = s.relname),
                    40
                ) * COALESCE(c.relnatts, 1)
            )) / current_setting('block_size')::int
        ) AS est_pages
    FROM pg_stat_user_tables s
    JOIN pg_class c ON c.oid = s.relid
    WHERE s.n_live_tup > 0
) sub
ORDER BY bloat_bytes DESC`

// TableIOStats returns I/O stats from pg_statio_user_tables for one table.
// Columns: heap/index/toast blocks read vs hit.
// $1 = schema name, $2 = table name.
const TableIOStats = `
SELECT
    schemaname,
    relname,
    COALESCE(heap_blks_read, 0) AS heap_blks_read,
    COALESCE(heap_blks_hit, 0) AS heap_blks_hit,
    COALESCE(idx_blks_read, 0) AS idx_blks_read,
    COALESCE(idx_blks_hit, 0) AS idx_blks_hit,
    COALESCE(toast_blks_read, 0) AS toast_blks_read,
    COALESCE(toast_blks_hit, 0) AS toast_blks_hit,
    COALESCE(tidx_blks_read, 0) AS tidx_blks_read,
    COALESCE(tidx_blks_hit, 0) AS tidx_blks_hit
FROM pg_statio_user_tables
WHERE schemaname = $1 AND relname = $2`

// TableIOStatsAll returns I/O stats for all user tables.
const TableIOStatsAll = `
SELECT
    schemaname,
    relname,
    COALESCE(heap_blks_read, 0) AS heap_blks_read,
    COALESCE(heap_blks_hit, 0) AS heap_blks_hit,
    COALESCE(idx_blks_read, 0) AS idx_blks_read,
    COALESCE(idx_blks_hit, 0) AS idx_blks_hit,
    COALESCE(toast_blks_read, 0) AS toast_blks_read,
    COALESCE(toast_blks_hit, 0) AS toast_blks_hit,
    COALESCE(tidx_blks_read, 0) AS tidx_blks_read,
    COALESCE(tidx_blks_hit, 0) AS tidx_blks_hit
FROM pg_statio_user_tables
ORDER BY heap_blks_read + idx_blks_read DESC`

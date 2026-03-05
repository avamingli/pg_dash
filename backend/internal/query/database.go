package query

// DatabaseList returns comprehensive database stats by joining pg_database
// with pg_stat_database. Includes sizes, transaction counts, tuple counts,
// I/O, temp file usage, deadlocks, cache hit ratio, and session stats.
const DatabaseList = `
SELECT
    d.datname,
    pg_database_size(d.datname) AS size,
    COALESCE(s.numbackends, 0) AS numbackends,
    COALESCE(s.xact_commit, 0) AS xact_commit,
    COALESCE(s.xact_rollback, 0) AS xact_rollback,
    COALESCE(s.blks_read, 0) AS blks_read,
    COALESCE(s.blks_hit, 0) AS blks_hit,
    COALESCE(s.tup_returned, 0) AS tup_returned,
    COALESCE(s.tup_fetched, 0) AS tup_fetched,
    COALESCE(s.tup_inserted, 0) AS tup_inserted,
    COALESCE(s.tup_updated, 0) AS tup_updated,
    COALESCE(s.tup_deleted, 0) AS tup_deleted,
    COALESCE(s.conflicts, 0) AS conflicts,
    COALESCE(s.temp_files, 0) AS temp_files,
    COALESCE(s.temp_bytes, 0) AS temp_bytes,
    COALESCE(s.deadlocks, 0) AS deadlocks,
    COALESCE(s.blk_read_time, 0) AS blk_read_time,
    COALESCE(s.blk_write_time, 0) AS blk_write_time,
    CASE WHEN COALESCE(s.blks_hit, 0) + COALESCE(s.blks_read, 0) > 0
         THEN round(
             s.blks_hit::numeric /
             (s.blks_hit + s.blks_read) * 100, 2)
         ELSE 0
    END AS cache_hit_ratio,
    COALESCE(s.session_time, 0) AS session_time,
    COALESCE(s.active_time, 0) AS active_time,
    COALESCE(s.idle_in_transaction_time, 0) AS idle_in_transaction_time,
    COALESCE(s.sessions, 0) AS sessions,
    COALESCE(s.sessions_abandoned, 0) AS sessions_abandoned,
    COALESCE(s.sessions_fatal, 0) AS sessions_fatal,
    COALESCE(s.sessions_killed, 0) AS sessions_killed,
    s.stats_reset
FROM pg_database d
LEFT JOIN pg_stat_database s ON d.datname = s.datname
WHERE d.datistemplate = false
ORDER BY pg_database_size(d.datname) DESC`

// DatabaseSizes returns all non-template databases with their sizes,
// sorted by size descending. Used for the overview total database size card.
const DatabaseSizes = `
SELECT
    datname,
    pg_database_size(datname) AS size
FROM pg_database
WHERE datistemplate = false
ORDER BY size DESC`

// DatabaseSizeTotal returns the sum of all non-template database sizes.
const DatabaseSizeTotal = `
SELECT COALESCE(sum(pg_database_size(datname)), 0) AS total_size
FROM pg_database
WHERE datistemplate = false`

// DatabaseTPS returns the current commit/rollback counters for all databases.
// The caller should compute deltas between two snapshots to derive TPS.
const DatabaseTPS = `
SELECT
    COALESCE(sum(xact_commit), 0) AS total_commits,
    COALESCE(sum(xact_rollback), 0) AS total_rollbacks
FROM pg_stat_database`

// DatabaseCacheHitRatio returns the overall cache hit ratio across all databases.
const DatabaseCacheHitRatio = `
SELECT
    CASE WHEN sum(blks_hit) + sum(blks_read) > 0
         THEN round(
             sum(blks_hit)::numeric /
             (sum(blks_hit) + sum(blks_read)) * 100, 2)
         ELSE 0
    END AS cache_hit_ratio
FROM pg_stat_database`

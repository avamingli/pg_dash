package query

// TopQuerysByTotalTime returns the top queries from pg_stat_statements
// ordered by total execution time. Requires pg_stat_statements extension.
// $1 = limit.
const TopQuerysByTotalTime = `
SELECT
    queryid,
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    min_exec_time,
    max_exec_time,
    stddev_exec_time,
    rows,
    shared_blks_hit,
    shared_blks_read,
    local_blks_hit,
    local_blks_read,
    temp_blks_read,
    temp_blks_written,
    shared_blk_read_time AS blk_read_time,
    shared_blk_write_time AS blk_write_time,
    wal_records,
    wal_fpi,
    wal_bytes
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT $1`

// TopQuerysByCalls returns top queries ordered by call count.
// $1 = limit.
const TopQuerysByCalls = `
SELECT
    queryid,
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    min_exec_time,
    max_exec_time,
    stddev_exec_time,
    rows,
    shared_blks_hit,
    shared_blks_read,
    local_blks_hit,
    local_blks_read,
    temp_blks_read,
    temp_blks_written,
    shared_blk_read_time AS blk_read_time,
    shared_blk_write_time AS blk_write_time,
    wal_records,
    wal_fpi,
    wal_bytes
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT $1`

// TopQuerysByRows returns top queries ordered by total rows returned.
// $1 = limit.
const TopQuerysByRows = `
SELECT
    queryid,
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    min_exec_time,
    max_exec_time,
    stddev_exec_time,
    rows,
    shared_blks_hit,
    shared_blks_read,
    local_blks_hit,
    local_blks_read,
    temp_blks_read,
    temp_blks_written,
    shared_blk_read_time AS blk_read_time,
    shared_blk_write_time AS blk_write_time,
    wal_records,
    wal_fpi,
    wal_bytes
FROM pg_stat_statements
ORDER BY rows DESC
LIMIT $1`

// TopQuerysByTemp returns top queries ordered by temp blocks written.
// $1 = limit.
const TopQuerysByTemp = `
SELECT
    queryid,
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    shared_blks_hit,
    shared_blks_read,
    temp_blks_read,
    temp_blks_written
FROM pg_stat_statements
WHERE temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT $1`

// StatementsReset resets the pg_stat_statements statistics.
const StatementsReset = `SELECT pg_stat_statements_reset()`

// StatementsAvailable checks whether pg_stat_statements extension is installed.
const StatementsAvailable = `
SELECT EXISTS(
    SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
) AS available`

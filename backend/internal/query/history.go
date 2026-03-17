package query

// HistoryTableDDL creates the dbhouse_query_history table.
const HistoryTableDDL = `
CREATE TABLE IF NOT EXISTS dbhouse_query_history (
    id               BIGSERIAL PRIMARY KEY,
    queryid          BIGINT,
    database         TEXT NOT NULL DEFAULT current_database(),
    username         TEXT NOT NULL,
    query_text       TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'done',
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    duration_ms      DOUBLE PRECISION DEFAULT 0,
    rows_affected    BIGINT DEFAULT 0,
    shared_blks_hit  BIGINT DEFAULT 0,
    shared_blks_read BIGINT DEFAULT 0,
    temp_blks_written BIGINT DEFAULT 0,
    wal_bytes        BIGINT DEFAULT 0,
    calls            BIGINT DEFAULT 0,
    mean_exec_time   DOUBLE PRECISION DEFAULT 0
)`

// HistoryIndexDDL creates indexes for efficient searching.
const HistoryIndexDDL = `
CREATE INDEX IF NOT EXISTS idx_dbh_qhist_submitted ON dbhouse_query_history (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_dbh_qhist_queryid   ON dbhouse_query_history (queryid);
CREATE INDEX IF NOT EXISTS idx_dbh_qhist_username   ON dbhouse_query_history (username);
CREATE INDEX IF NOT EXISTS idx_dbh_qhist_duration   ON dbhouse_query_history (duration_ms DESC)`

// HistoryInsert inserts a query history entry from pg_stat_statements diff.
const HistoryInsert = `
INSERT INTO dbhouse_query_history
    (queryid, database, username, query_text, status, submitted_at, ended_at,
     duration_ms, rows_affected, shared_blks_hit, shared_blks_read,
     temp_blks_written, wal_bytes, calls, mean_exec_time)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`

// HistoryCleanup deletes records older than the retention period.
// $1 = retention interval (e.g., '7 days').
const HistoryCleanup = `
DELETE FROM dbhouse_query_history
WHERE submitted_at < now() - $1::interval`

// StatementsSnapshot captures current pg_stat_statements for diff tracking.
const StatementsSnapshot = `
SELECT
    s.queryid,
    r.rolname AS username,
    d.datname AS database,
    s.query,
    s.calls,
    s.total_exec_time,
    s.mean_exec_time,
    s.rows,
    s.shared_blks_hit,
    s.shared_blks_read,
    s.temp_blks_written,
    s.wal_bytes
FROM pg_stat_statements s
JOIN pg_roles r ON r.oid = s.userid
JOIN pg_database d ON d.oid = s.dbid
WHERE s.queryid != 0
  AND s.query NOT LIKE '%dbhouse_query_history%'`

// StatementsAvailable is defined in statements.go

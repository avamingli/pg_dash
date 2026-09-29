package query

// ActiveConnections returns all connections from pg_stat_activity.
// Includes pid, user, database, client info, timing, wait events, state,
// backend type, query_id, and the running query text.
const ActiveConnections = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    COALESCE(host(client_addr)::text, '') AS client_addr,
    COALESCE(client_port, 0) AS client_port,
    backend_start,
    xact_start,
    query_start,
    state_change,
    COALESCE(wait_event_type, '') AS wait_event_type,
    COALESCE(wait_event, '') AS wait_event,
    COALESCE(state, '') AS state,
    COALESCE(backend_type, '') AS backend_type,
    COALESCE(application_name, '') AS application_name,
    COALESCE(query_id, 0) AS query_id,
    COALESCE(query, '') AS query
FROM pg_stat_activity
ORDER BY backend_start`

// ActiveConnectionsLegacy is ActiveConnections without query_id, which was
// only added to pg_stat_activity in PostgreSQL 14 — MPP forks (Cloudberry,
// Greenplum, WarehousePG) are commonly based on PostgreSQL 12 and lack it.
const ActiveConnectionsLegacy = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    COALESCE(host(client_addr)::text, '') AS client_addr,
    COALESCE(client_port, 0) AS client_port,
    backend_start,
    xact_start,
    query_start,
    state_change,
    COALESCE(wait_event_type, '') AS wait_event_type,
    COALESCE(wait_event, '') AS wait_event,
    COALESCE(state, '') AS state,
    COALESCE(backend_type, '') AS backend_type,
    COALESCE(application_name, '') AS application_name,
    0 AS query_id,
    COALESCE(query, '') AS query
FROM pg_stat_activity
ORDER BY backend_start`

// ActiveConnectionsPre96 is ActiveConnectionsLegacy for servers older than
// PostgreSQL 9.6 — pg_stat_activity had no wait_event_type/wait_event there
// yet (added in 9.6, replacing a plain boolean); it only had `waiting`.
// backend_type is a separate, even later addition (PG 10), so it's always
// absent too on anything old enough to need this variant — no data to
// report, not just a differently-named column. Real WHPG6 (PostgreSQL 9.4)
// is the one fork/version this codebase targets that actually falls in
// this gap. Synthesize wait_event_type/wait_event so the frontend model
// needs no version-specific branch: wait_event_type becomes 'Lock' (the
// only reason `waiting` is ever true pre-9.6) or '', wait_event stays ''
// since the old boolean carries no finer detail to report.
const ActiveConnectionsPre96 = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    COALESCE(host(client_addr)::text, '') AS client_addr,
    COALESCE(client_port, 0) AS client_port,
    backend_start,
    xact_start,
    query_start,
    state_change,
    CASE WHEN waiting THEN 'Lock' ELSE '' END AS wait_event_type,
    '' AS wait_event,
    COALESCE(state, '') AS state,
    '' AS backend_type,
    COALESCE(application_name, '') AS application_name,
    0 AS query_id,
    COALESCE(query, '') AS query
FROM pg_stat_activity
ORDER BY backend_start`

// ConnectionCountsByState returns connection counts grouped by state.
// Useful for the summary bar chart showing active/idle/idle-in-transaction.
const ConnectionCountsByState = `
SELECT COALESCE(state, 'unknown') AS label, count(*) AS count
FROM pg_stat_activity
GROUP BY state
ORDER BY count DESC`

// ConnectionCountsByDatabase returns connection counts grouped by database.
// Useful for the pie chart of connections per database.
const ConnectionCountsByDatabase = `
SELECT COALESCE(datname, 'unknown') AS label, count(*) AS count
FROM pg_stat_activity
GROUP BY datname
ORDER BY count DESC`

// ConnectionCountsByUser returns connection counts grouped by user.
const ConnectionCountsByUser = `
SELECT COALESCE(usename, 'unknown') AS label, count(*) AS count
FROM pg_stat_activity
GROUP BY usename
ORDER BY count DESC`

// LongRunningQueries returns active queries running longer than the given threshold.
// $1 = interval string (e.g. '5 seconds').
const LongRunningQueries = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    COALESCE(host(client_addr)::text, '') AS client_addr,
    extract(epoch FROM (now() - query_start))::float8 AS duration_seconds,
    COALESCE(wait_event_type, '') AS wait_event_type,
    COALESCE(wait_event, '') AS wait_event,
    COALESCE(query, '') AS query
FROM pg_stat_activity
WHERE state = 'active'
  AND pid != pg_backend_pid()
  AND query_start < now() - $1::interval
ORDER BY query_start`

// BlockedQueries returns queries that are waiting on locks.
// Includes the blocking PIDs via pg_blocking_pids().
const BlockedQueries = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    COALESCE(wait_event_type, '') AS wait_event_type,
    COALESCE(wait_event, '') AS wait_event,
    extract(epoch FROM (now() - query_start))::float8 AS duration_seconds,
    pg_blocking_pids(pid) AS blocking_pids,
    COALESCE(query, '') AS query
FROM pg_stat_activity
WHERE wait_event_type = 'Lock'
  AND pid != pg_backend_pid()
ORDER BY query_start`

// LongRunningQueriesPre96/BlockedQueriesPre96: see ActiveConnectionsPre96 —
// same pre-9.6 substitution (no wait_event_type/wait_event, only `waiting`).
const LongRunningQueriesPre96 = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    COALESCE(host(client_addr)::text, '') AS client_addr,
    extract(epoch FROM (now() - query_start))::float8 AS duration_seconds,
    CASE WHEN waiting THEN 'Lock' ELSE '' END AS wait_event_type,
    '' AS wait_event,
    COALESCE(query, '') AS query
FROM pg_stat_activity
WHERE state = 'active'
  AND pid != pg_backend_pid()
  AND query_start < now() - $1::interval
ORDER BY query_start`

// pg_blocking_pids() is itself a PG 9.6+ addition, so BlockedQueriesPre96
// can't call it either — recompute the same thing its own C implementation
// does, the classic pre-9.6 pg_locks self-join (matching the old
// PostgreSQL wiki "lock_monitor" idiom): a blocking lock is any granted
// lock on the same lockable object as one of this pid's ungranted locks.
const BlockedQueriesPre96 = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    'Lock' AS wait_event_type,
    '' AS wait_event,
    extract(epoch FROM (now() - query_start))::float8 AS duration_seconds,
    (SELECT array_agg(DISTINCT blocking.pid)
     FROM pg_locks blocking
     JOIN pg_locks blocked
       ON blocking.locktype = blocked.locktype
      AND blocking.database IS NOT DISTINCT FROM blocked.database
      AND blocking.relation IS NOT DISTINCT FROM blocked.relation
      AND blocking.page IS NOT DISTINCT FROM blocked.page
      AND blocking.tuple IS NOT DISTINCT FROM blocked.tuple
      AND blocking.virtualxid IS NOT DISTINCT FROM blocked.virtualxid
      AND blocking.transactionid IS NOT DISTINCT FROM blocked.transactionid
      AND blocking.classid IS NOT DISTINCT FROM blocked.classid
      AND blocking.objid IS NOT DISTINCT FROM blocked.objid
      AND blocking.objsubid IS NOT DISTINCT FROM blocked.objsubid
      AND blocking.pid != blocked.pid
     WHERE blocked.pid = pg_stat_activity.pid
       AND NOT blocked.granted
       AND blocking.granted
    ) AS blocking_pids,
    COALESCE(query, '') AS query
FROM pg_stat_activity
WHERE waiting
  AND pid != pg_backend_pid()
ORDER BY query_start`

// IdleInTransaction returns sessions idle in transaction longer than the threshold.
// $1 = interval string (e.g. '30 seconds').
const IdleInTransaction = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(datname, '') AS datname,
    COALESCE(host(client_addr)::text, '') AS client_addr,
    extract(epoch FROM (now() - state_change))::float8 AS duration_seconds,
    COALESCE(query, '') AS query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND state_change < now() - $1::interval
ORDER BY state_change`

// CancelBackend cancels the running query for the given PID.
// $1 = pid. Returns true if the signal was sent.
const CancelBackend = `SELECT pg_cancel_backend($1)`

// TerminateBackend terminates the backend process for the given PID.
// $1 = pid. Returns true if the signal was sent.
const TerminateBackend = `SELECT pg_terminate_backend($1)`

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
    COALESCE(query_id, 0) AS query_id,
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

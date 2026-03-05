package query

// CurrentLocks returns all current locks with relation names resolved.
// Filters out the monitoring connection's own PID.
const CurrentLocks = `
SELECT
    l.locktype,
    COALESCE(d.datname, '') AS database,
    COALESCE(c.relname, '') AS relation,
    l.mode,
    l.granted,
    l.pid,
    COALESCE(a.usename, '') AS usename,
    COALESCE(a.query, '') AS query,
    COALESCE(a.state, '') AS state,
    extract(epoch FROM (now() - a.query_start))::float8 AS duration_seconds
FROM pg_locks l
LEFT JOIN pg_database d ON l.database = d.oid
LEFT JOIN pg_class c ON l.relation = c.oid
LEFT JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.pid != pg_backend_pid()
ORDER BY l.pid`

// LockConflicts returns blocking/blocked PID pairs with their queries.
// Uses the standard pg_locks self-join to find conflicting lock pairs.
const LockConflicts = `
SELECT
    blocking_locks.pid AS blocking_pid,
    COALESCE(blocking_activity.usename, '') AS blocking_user,
    COALESCE(blocking_activity.query, '') AS blocking_query,
    COALESCE(blocking_activity.state, '') AS blocking_state,
    blocked_locks.pid AS blocked_pid,
    COALESCE(blocked_activity.usename, '') AS blocked_user,
    COALESCE(blocked_activity.query, '') AS blocked_query,
    extract(epoch FROM (now() - blocked_activity.query_start))::float8 AS blocked_duration_seconds
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked_activity
    ON blocked_activity.pid = blocked_locks.pid
JOIN pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
   AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
   AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
   AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
   AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
   AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
   AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
   AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
   AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
   AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
   AND blocking_locks.pid != blocked_locks.pid
JOIN pg_stat_activity blocking_activity
    ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted
ORDER BY blocked_activity.query_start`

// BlockingChains uses pg_blocking_pids() to build a blocking tree.
// Shows each blocked PID, who blocks it, and the associated query.
const BlockingChains = `
SELECT
    a.pid,
    pg_blocking_pids(a.pid) AS blocking_pids,
    COALESCE(a.usename, '') AS usename,
    COALESCE(a.datname, '') AS datname,
    COALESCE(a.query, '') AS query,
    COALESCE(a.state, '') AS state,
    extract(epoch FROM (now() - a.query_start))::float8 AS duration_seconds
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0
ORDER BY a.query_start`

// LockTypeSummary returns lock counts grouped by lock type, for distribution charts.
const LockTypeSummary = `
SELECT mode, count(*) AS count
FROM pg_locks
WHERE pid != pg_backend_pid()
GROUP BY mode
ORDER BY count DESC`

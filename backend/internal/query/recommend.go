package query

// XIDAgeDatabases returns transaction ID age for all databases.
const XIDAgeDatabases = `
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    round(age(datfrozenxid)::numeric / 2147483647 * 100, 2) AS xid_pct
FROM pg_database
WHERE datistemplate = false
ORDER BY age(datfrozenxid) DESC`

// XIDAgeTables returns per-table frozen XID age above a threshold.
// $1 = minimum age (e.g., 100000000).
const XIDAgeTables = `
SELECT
    n.nspname AS schemaname,
    c.relname,
    age(c.relfrozenxid) AS xid_age,
    round(age(c.relfrozenxid)::numeric / 2147483647 * 100, 2) AS xid_pct,
    pg_total_relation_size(c.oid) AS total_size,
    COALESCE(s.last_autovacuum::text, COALESCE(s.last_vacuum::text, 'never')) AS last_vacuum
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND age(c.relfrozenxid) > $1
ORDER BY age(c.relfrozenxid) DESC
LIMIT 100`

// StaleStatsTables returns tables with outdated statistics.
const StaleStatsTables = `
SELECT
    schemaname,
    relname,
    n_live_tup,
    n_mod_since_analyze,
    COALESCE(last_analyze, last_autoanalyze) AS last_analyze,
    pg_total_relation_size(relid) AS total_size
FROM pg_stat_user_tables
WHERE (COALESCE(last_analyze, last_autoanalyze) IS NULL
       OR COALESCE(last_analyze, last_autoanalyze) < now() - interval '7 days')
  AND n_mod_since_analyze > 1000
ORDER BY n_mod_since_analyze DESC
LIMIT 100`

// HighDeadTupleTables returns tables with dead tuple ratio above threshold.
// $1 = minimum dead tuple percentage (e.g., 10).
const HighDeadTupleTables = `
SELECT
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    CASE WHEN n_live_tup + n_dead_tup > 0
         THEN round(n_dead_tup::numeric / (n_live_tup + n_dead_tup) * 100, 2)
         ELSE 0
    END AS dead_pct,
    pg_total_relation_size(relid) AS total_size,
    COALESCE(last_autovacuum::text, COALESCE(last_vacuum::text, 'never')) AS last_vacuum
FROM pg_stat_user_tables
WHERE CASE WHEN n_live_tup + n_dead_tup > 0
           THEN n_dead_tup::numeric / (n_live_tup + n_dead_tup) * 100
           ELSE 0
      END > $1
ORDER BY n_dead_tup DESC
LIMIT 100`

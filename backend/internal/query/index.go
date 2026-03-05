package query

// IndexList returns all user indexes with scan stats and sizes.
// Joined from pg_stat_user_indexes with pg_relation_size for each index.
const IndexList = `
SELECT
    s.schemaname,
    s.relname,
    s.indexrelname,
    pg_relation_size(s.indexrelid) AS size,
    s.idx_scan,
    s.idx_tup_read,
    s.idx_tup_fetch
FROM pg_stat_user_indexes s
ORDER BY pg_relation_size(s.indexrelid) DESC`

// UnusedIndexes returns indexes that have never been scanned since stats reset.
// These are candidates for removal. Excludes unique indexes since they serve
// a constraint purpose even without scans.
const UnusedIndexes = `
SELECT
    s.schemaname,
    s.relname,
    s.indexrelname,
    pg_relation_size(s.indexrelid) AS size,
    s.idx_scan,
    i.indisunique,
    i.indisprimary
FROM pg_stat_user_indexes s
JOIN pg_index i ON s.indexrelid = i.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC`

// DuplicateIndexes detects indexes on the same table with the same column set.
// Uses pg_index.indkey to compare the column list. If two indexes cover
// exactly the same columns, one is likely redundant.
const DuplicateIndexes = `
SELECT
    n.nspname AS schemaname,
    ct.relname AS tablename,
    ci1.relname AS index1,
    ci2.relname AS index2,
    pg_relation_size(i1.indexrelid) AS index1_size,
    pg_relation_size(i2.indexrelid) AS index2_size
FROM pg_index i1
JOIN pg_index i2
    ON i1.indrelid = i2.indrelid
   AND i1.indexrelid < i2.indexrelid
   AND i1.indkey = i2.indkey
JOIN pg_class ct ON ct.oid = i1.indrelid
JOIN pg_class ci1 ON ci1.oid = i1.indexrelid
JOIN pg_class ci2 ON ci2.oid = i2.indexrelid
JOIN pg_namespace n ON n.oid = ct.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_relation_size(i1.indexrelid) + pg_relation_size(i2.indexrelid) DESC`

// IndexBloat estimates index bloat using a statistical method.
// Compares actual index size (relpages) to an estimate based on the table's
// row count and the average width of the indexed columns from pg_stats.
const IndexBloat = `
SELECT
    sub.schemaname,
    sub.tablename,
    sub.indexname,
    pg_relation_size(sub.indexrelid) AS real_size,
    CASE WHEN sub.est_pages > 0
         THEN (sub.bs * sub.est_pages)::bigint
         ELSE 0
    END AS expected_size,
    CASE WHEN sub.real_pages > 0 AND sub.est_pages > 0 AND sub.real_pages > sub.est_pages
         THEN (sub.bs * (sub.real_pages - sub.est_pages))::bigint
         ELSE 0
    END AS bloat_bytes,
    CASE WHEN sub.real_pages > 0 AND sub.est_pages > 0 AND sub.real_pages > sub.est_pages
         THEN round((100.0 * (sub.real_pages - sub.est_pages) / sub.real_pages)::numeric, 1)
         ELSE 0
    END AS bloat_pct
FROM (
    SELECT
        n.nspname AS schemaname,
        ct.relname AS tablename,
        ci.relname AS indexname,
        i.indexrelid,
        current_setting('block_size')::int AS bs,
        ci.relpages AS real_pages,
        CEIL(
            ct.reltuples *
            (8 + COALESCE(
                (SELECT sum(s.avg_width)
                 FROM pg_attribute a
                 JOIN pg_stats s
                     ON s.schemaname = n.nspname
                    AND s.tablename = ct.relname
                    AND s.attname = a.attname
                 WHERE a.attrelid = i.indrelid
                   AND a.attnum = ANY(i.indkey)
                ),
                24
            ))
            / NULLIF(current_setting('block_size')::int - 64, 0)
        ) AS est_pages
    FROM pg_index i
    JOIN pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_class ct ON ct.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = ct.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND ct.reltuples > 0
) sub
ORDER BY bloat_bytes DESC`

// IndexesForTable returns all indexes for a specific table.
// $1 = schema name, $2 = table name.
const IndexesForTable = `
SELECT
    s.schemaname,
    s.relname,
    s.indexrelname,
    pg_relation_size(s.indexrelid) AS size,
    s.idx_scan,
    s.idx_tup_read,
    s.idx_tup_fetch,
    i.indisunique,
    i.indisprimary,
    pg_get_indexdef(s.indexrelid) AS indexdef
FROM pg_stat_user_indexes s
JOIN pg_index i ON s.indexrelid = i.indexrelid
WHERE s.schemaname = $1 AND s.relname = $2
ORDER BY pg_relation_size(s.indexrelid) DESC`

package query

// ── Cluster topology ──

// ClusterTopology returns all segments from gp_segment_configuration.
const ClusterTopology = `
SELECT
    dbid, content,
    CASE role WHEN 'p' THEN 'primary' WHEN 'm' THEN 'mirror' ELSE role::text END AS role,
    CASE preferred_role WHEN 'p' THEN 'primary' WHEN 'm' THEN 'mirror' ELSE preferred_role::text END AS preferred_role,
    CASE mode WHEN 's' THEN 'synchronized' WHEN 'n' THEN 'not_synced' ELSE mode::text END AS mode,
    CASE status WHEN 'u' THEN 'up' WHEN 'd' THEN 'down' ELSE status::text END AS status,
    hostname, port, datadir,
    (content = -1) AS is_coordinator,
    (role = preferred_role) AS is_balanced
FROM gp_segment_configuration
ORDER BY content, role
`

// SegmentHealth returns a single-row summary of cluster health.
const SegmentHealth = `
SELECT
    count(*) FILTER (WHERE content >= 0 AND role = 'p' AND status = 'u') AS primaries_up,
    count(*) FILTER (WHERE content >= 0 AND role = 'p' AND status = 'd') AS primaries_down,
    count(*) FILTER (WHERE content >= 0 AND role = 'm' AND status = 'u') AS mirrors_up,
    count(*) FILTER (WHERE content >= 0 AND role = 'm' AND status = 'd') AS mirrors_down,
    count(*) FILTER (WHERE role <> preferred_role) AS unbalanced,
    count(*) FILTER (WHERE mode = 'n') AS not_synchronized
FROM gp_segment_configuration
`

// ── Replication ──

// SegmentReplication returns WAL replication status per segment pair.
const SegmentReplication = `
SELECT
    gp_segment_id,
    coalesce(state, '') AS state,
    coalesce(sync_state, '') AS sync_state,
    coalesce(sync_error, 'none') AS sync_error,
    coalesce(write_lag::text, '') AS write_lag,
    coalesce(flush_lag::text, '') AS flush_lag,
    coalesce(replay_lag::text, '') AS replay_lag
FROM gp_stat_replication
ORDER BY gp_segment_id
`

// ── FTS history ──

// ConfigHistory returns recent FTS events (failover/recovery).
const ConfigHistory = `
SELECT
    time::text,
    dbid,
    "desc" AS description
FROM gp_configuration_history
ORDER BY time DESC
LIMIT $1
`

// ── Resource Queues (gp_resource_manager = 'queue') ──

// ResourceQueueStatus returns resource queue limits vs usage.
const ResourceQueueStatus = `
SELECT
    rsqname AS name,
    rsqcountlimit::text AS count_limit,
    rsqcountvalue::text AS count_value,
    rsqcostlimit::text AS cost_limit,
    rsqcostvalue::text AS cost_value,
    rsqmemorylimit::text AS memory_limit,
    rsqmemoryvalue::text AS memory_value,
    rsqwaiters AS waiters,
    rsqholders AS holders
FROM gp_toolkit.gp_resqueue_status
ORDER BY rsqname
`

// ── Resource Groups (gp_resource_manager = 'group') ──

// ResourceGroupConfig returns resource group configuration.
const ResourceGroupConfig = `
SELECT
    groupname AS group_name,
    concurrency::text,
    cpu_max_percent::text,
    cpu_weight::text,
    memory_quota::text,
    min_cost::text,
    io_limit::text
FROM gp_toolkit.gp_resgroup_config
ORDER BY groupname
`

// ResourceGroupStatus returns resource group runtime status.
const ResourceGroupStatus = `
SELECT
    groupname AS group_name,
    num_running,
    num_queueing,
    num_queued,
    num_executed,
    total_queue_duration::text
FROM gp_toolkit.gp_resgroup_status
ORDER BY groupname
`

// ── Per-segment stats ──

// PerSegmentDBStats returns per-segment database-level statistics.
const PerSegmentDBStats = `
SELECT
    gp_segment_id,
    sum(xact_commit) AS xact_commit,
    sum(xact_rollback) AS xact_rollback,
    sum(blks_read) AS blks_read,
    sum(blks_hit) AS blks_hit,
    sum(temp_files) AS temp_files,
    sum(temp_bytes) AS temp_bytes
FROM gp_stat_database
WHERE datname = current_database()
GROUP BY gp_segment_id
ORDER BY gp_segment_id
`

// ── Workfiles / spill ──

// WorkfileUsagePerSegment returns spill usage per segment.
const WorkfileUsagePerSegment = `
SELECT
    segid AS gp_segment_id,
    COALESCE(size, 0) AS size,
    COALESCE(numfiles, 0) AS num_files
FROM gp_toolkit.gp_workfile_usage_per_segment
ORDER BY segid
`

// WorkfileEntries returns active workfile entries.
const WorkfileEntries = `
SELECT
    segid AS gp_segment_id,
    prefix,
    size,
    optype,
    slice,
    numfiles
FROM gp_toolkit.gp_workfile_entries
ORDER BY size DESC
`

// ── Data skew ──

// DataSkewCoefficients returns tables with notable data skew (coefficient > 5).
const DataSkewCoefficients = `
SELECT
    skcnamespace AS schema,
    skcrelname AS table_name,
    skccoeff AS coefficient
FROM gp_toolkit.gp_skew_coefficients
WHERE skccoeff > 5
ORDER BY skccoeff DESC
LIMIT 50
`

// ── Disk free per segment ──

// DiskFreePerSegment returns disk free space per segment host.
const DiskFreePerSegment = `
SELECT
    dfsegment AS gp_segment_id,
    dfhostname AS hostname,
    dfdevice AS device,
    dfspace AS space
FROM gp_toolkit.gp_disk_free
ORDER BY dfsegment
`

// ── Per-host metrics ──

// PerHostMetrics returns aggregate stats per segment host.
const PerHostMetrics = `
SELECT
    c.hostname,
    count(*) FILTER (WHERE c.role = 'p' AND c.content >= 0) AS primary_count,
    count(*) FILTER (WHERE c.role = 'm' AND c.content >= 0) AS mirror_count,
    count(*) FILTER (WHERE c.status = 'd') AS down_count,
    count(*) FILTER (WHERE c.role <> c.preferred_role) AS unbalanced_count,
    COALESCE(sum(d.xact_commit + d.xact_rollback), 0) AS total_tps,
    COALESCE(sum(d.temp_bytes), 0) AS total_temp_bytes,
    CASE WHEN sum(d.blks_hit + d.blks_read) > 0
         THEN round((sum(d.blks_hit)::numeric / sum(d.blks_hit + d.blks_read) * 100), 2)
         ELSE 100
    END AS cache_hit_ratio
FROM gp_segment_configuration c
LEFT JOIN gp_stat_database d
    ON c.content = d.gp_segment_id AND d.datname = current_database()
WHERE c.content >= 0
GROUP BY c.hostname
ORDER BY c.hostname`

// ── Distribution policy ──

// TableDistributionPolicy returns the distribution policy for a table.
// $1 = schema name, $2 = table name.
const TableDistributionPolicy = `
SELECT
    p.localoid::regclass::text AS table_name,
    CASE p.policytype
        WHEN 'p' THEN 'partitioned'
        WHEN 'r' THEN 'replicated'
        ELSE 'distributed'
    END AS policy_type,
    COALESCE(
        (SELECT string_agg(a.attname, ', ' ORDER BY ord)
         FROM unnest(p.distkey) WITH ORDINALITY AS dk(col, ord)
         JOIN pg_attribute a ON a.attrelid = p.localoid AND a.attnum = dk.col),
        ''
    ) AS dist_columns
FROM gp_distribution_policy p
WHERE p.localoid = ($1 || '.' || $2)::regclass`

// ── Config diffs across segments ──

// ConfigDiffs returns settings that differ across segments.
const ConfigDiffs = `
SELECT
    psdname AS name,
    psdvalue AS value,
    psdcount AS count
FROM gp_toolkit.gp_param_settings_seg_value_diffs
ORDER BY psdname
`

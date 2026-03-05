package query

// ReplicationStatus returns replication info from pg_stat_replication.
// Shows each connected replica with its LSN positions and lag values.
const ReplicationStatus = `
SELECT
    pid,
    COALESCE(usename, '') AS usename,
    COALESCE(application_name, '') AS application_name,
    COALESCE(host(client_addr)::text, '') AS client_addr,
    COALESCE(state, '') AS state,
    COALESCE(sent_lsn::text, '') AS sent_lsn,
    COALESCE(write_lsn::text, '') AS write_lsn,
    COALESCE(flush_lsn::text, '') AS flush_lsn,
    COALESCE(replay_lsn::text, '') AS replay_lsn,
    COALESCE(write_lag::text, '') AS write_lag,
    COALESCE(flush_lag::text, '') AS flush_lag,
    COALESCE(replay_lag::text, '') AS replay_lag,
    COALESCE(sync_state, '') AS sync_state,
    COALESCE(sync_priority, 0) AS sync_priority,
    COALESCE(reply_time::text, '') AS reply_time
FROM pg_stat_replication
ORDER BY application_name`

// ReplicationSlots returns all replication slot details.
// Includes slot type, active status, LSN positions, WAL status,
// and PG 17+ columns like failover and synced.
const ReplicationSlots = `
SELECT
    slot_name,
    COALESCE(slot_type, '') AS slot_type,
    COALESCE(database, '') AS database,
    temporary,
    active,
    COALESCE(active_pid, 0) AS active_pid,
    COALESCE(restart_lsn::text, '') AS restart_lsn,
    COALESCE(confirmed_flush_lsn::text, '') AS confirmed_flush_lsn,
    COALESCE(wal_status, '') AS wal_status,
    COALESCE(safe_wal_size, 0) AS safe_wal_size,
    COALESCE(inactive_since::text, '') AS inactive_since
FROM pg_replication_slots
ORDER BY slot_name`

// WALStats returns WAL generation statistics from pg_stat_wal.
// Available in PG 14+. PG 19 columns: wal_records, wal_fpi, wal_bytes,
// wal_fpi_bytes, wal_buffers_full, stats_reset.
const WALStats = `
SELECT
    wal_records,
    wal_fpi,
    wal_bytes,
    wal_fpi_bytes,
    wal_buffers_full,
    stats_reset
FROM pg_stat_wal`

// CurrentWALLSN returns the current WAL insert position.
// Useful for computing replication lag in bytes.
const CurrentWALLSN = `SELECT pg_current_wal_lsn()::text AS current_lsn`

// WALIsRecovery returns whether the server is in recovery mode (replica).
const WALIsRecovery = `SELECT pg_is_in_recovery() AS is_recovery`

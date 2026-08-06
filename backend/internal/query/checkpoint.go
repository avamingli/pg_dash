package query

// CheckpointStats returns checkpoint statistics from pg_stat_checkpointer.
// In PG 17+ the checkpoint columns moved from pg_stat_bgwriter to this view.
// Columns: num_timed, num_requested, num_done, restartpoints, write/sync time,
// buffers_written, slru_written.
const CheckpointStats = `
SELECT
    num_timed,
    num_requested,
    num_done,
    restartpoints_timed,
    restartpoints_req,
    restartpoints_done,
    write_time,
    sync_time,
    buffers_written,
    slru_written,
    stats_reset
FROM pg_stat_checkpointer`

// CheckpointStatsLegacy is CheckpointStats for servers older than PG 17,
// where the checkpoint columns lived on pg_stat_bgwriter instead of a
// separate pg_stat_checkpointer view. There's no pre-17 equivalent of
// num_done/restartpoints_*/slru_written (those track concepts pg_stat_
// checkpointer introduced), so they're 0.
const CheckpointStatsLegacy = `
SELECT
    checkpoints_timed AS num_timed,
    checkpoints_req AS num_requested,
    0 AS num_done,
    0 AS restartpoints_timed,
    0 AS restartpoints_req,
    0 AS restartpoints_done,
    checkpoint_write_time AS write_time,
    checkpoint_sync_time AS sync_time,
    buffers_checkpoint AS buffers_written,
    0 AS slru_written,
    stats_reset
FROM pg_stat_bgwriter`

// BGWriterStats returns background writer statistics from pg_stat_bgwriter.
// In PG 17+ this view only contains bgwriter-specific columns (not checkpoint).
const BGWriterStats = `
SELECT
    buffers_clean,
    maxwritten_clean,
    buffers_alloc,
    stats_reset
FROM pg_stat_bgwriter`

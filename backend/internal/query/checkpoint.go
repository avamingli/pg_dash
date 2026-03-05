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

// BGWriterStats returns background writer statistics from pg_stat_bgwriter.
// In PG 17+ this view only contains bgwriter-specific columns (not checkpoint).
const BGWriterStats = `
SELECT
    buffers_clean,
    maxwritten_clean,
    buffers_alloc,
    stats_reset
FROM pg_stat_bgwriter`

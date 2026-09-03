package query

// InstrumentationDetailForSession returns live per-node, per-segment
// execution stats for one running query, sourced from
// query_metrics.gp_instrument_shmem_detail — a thin SQL wrapper (bootstrapped
// once by an operator, see InstrumentationSetupDDL) around GPDB's shared-
// memory query-metrics ring (gp_enable_query_metrics). nid is the plan
// node's plan_node_id; ntuples/tuplecount/nloops are rows produced so far.
// $1 = sess_id (pg_stat_activity.sess_id). ccnt (command count) isn't
// exposed on pg_stat_activity and isn't needed anyway — a session only ever
// has one command actively executing, so its slots all share the same
// (highest) ccnt; filtering to max(ccnt) picks that one and ignores any
// not-yet-recycled slots from an earlier command in the same session.
const InstrumentationDetailForSession = `
SELECT
    segid,
    pid,
    nid,
    tuplecount,
    nloops,
    ntuples
FROM query_metrics.gp_instrument_shmem_detail
WHERE ssid = $1
  AND ccnt = (SELECT max(ccnt) FROM query_metrics.gp_instrument_shmem_detail WHERE ssid = $1)
ORDER BY segid, nid`

// PlanTreeDetailForSession returns the real plan tree captured at query
// start by the standalone whpg_plan_tree extension (WHPG7/GPDB7, Cloudberry
// and WHPG19-next; see service.Capabilities.RealPlanShmem) — one row per
// (segment, plan node) with the true plan_node_id/parent_nid/node_type, no
// re-EXPLAIN and no client-side node-numbering needed. Lives in its own
// plan_tree schema, deliberately not query_metrics (that schema belongs
// to the unrelated, pre-existing gp_instrument_shmem_detail below). Same
// ccnt-filtering rationale as InstrumentationDetailForSession. $1 = sess_id.
const PlanTreeDetailForSession = `
SELECT
    segid,
    pid,
    nid,
    parent_nid,
    node_type,
    parallel_aware,
    strategy,
    partial_mode,
    operation,
    motion_senders,
    motion_receivers,
    relname,
    plan_rows,
    startup_cost,
    total_cost,
    plan_width
FROM plan_tree.plan_tree_detail
WHERE ssid = $1
  AND ccnt = (SELECT max(ccnt) FROM plan_tree.plan_tree_detail WHERE ssid = $1)
ORDER BY segid, nid`

// SessIDForPid resolves a pg_stat_activity.pid to its sess_id, the key
// InstrumentationDetailForSession/SessionMemoryForSession filter on.
// $1 = pid.
const SessIDForPid = `SELECT sess_id FROM pg_stat_activity WHERE pid = $1`

// SessIDForPidRunning is SessIDForPid plus a check that the backend is
// still running the query the caller started watching. Without this,
// once the watched query finishes, its pooled connection goes back to
// pg_dash's own connection pool and can be picked up by a completely
// unrelated query within one poll interval (including pg_dash's own
// periodic collector queries) — a bare pid match would then happily
// return that unrelated query's live nodes/plan as if they belonged to
// the original one. Substring, not equality, because pg_stat_activity
// often shows a wrapped form of what the caller submitted: the SQL
// Editor's read-only path prepends "BEGIN READ ONLY; " and appends
// "; ROLLBACK;", and simple-query multi-statement batches show the
// whole batch as one string. $1 = pid, $2 = the SQL text being watched.
const SessIDForPidRunning = `
SELECT sess_id FROM pg_stat_activity
WHERE pid = $1 AND state = 'active' AND position($2 in query) > 0`

// SessIDForPidByAppName is the tag-based version — the SQL Editor sets
// application_name = 'pg_dash:<uuid>' on the acquired conn before running
// the user's SQL, so we can match precisely without any string comparison
// against the query text (which is fragile: the read-only wrap and the
// simple-query batch form make the SQL in pg_stat_activity differ from
// what the client submitted). $1 = pid, $2 = 'pg_dash:<uuid>'.
const SessIDForPidByAppName = `
SELECT sess_id FROM pg_stat_activity
WHERE pid = $1 AND state = 'active' AND application_name = $2`

// SessionMemoryForSession returns live per-segment memory usage (MB) for one
// session, from gp_internal_tools' session_state.session_level_memory_consumption
// view (CREATE EXTENSION gp_internal_tools; — no restart needed).
// $1 = sess_id.
const SessionMemoryForSession = `
SELECT segid, vmem_mb
FROM session_state.session_level_memory_consumption
WHERE sess_id = $1
ORDER BY segid`

// InstrumentationSetupDDL is the one-time, operator-run bootstrap for
// query_metrics.gp_instrument_shmem_detail. Not executed by pg_dash itself —
// creating external web tables and C-backed functions is an explicit
// operator decision, same as enabling gp_enable_query_metrics (which also
// needs "gpconfig -c gp_enable_query_metrics -v on" + a "gpstop -raf"
// restart before this view returns any rows). Surfaced verbatim in the
// "not enabled" API response so the operator can copy-paste it.
const InstrumentationSetupDDL = `
CREATE SCHEMA IF NOT EXISTS query_metrics;
SET search_path = query_metrics;

CREATE EXTERNAL WEB TABLE __gp_localid (localid int)
EXECUTE E'echo $GP_SEGMENT_ID' FORMAT 'TEXT';

CREATE EXTERNAL WEB TABLE __gp_masterid (masterid int)
EXECUTE E'echo $GP_SEGMENT_ID' ON COORDINATOR FORMAT 'TEXT';

CREATE FUNCTION gp_instrument_shmem_detail_f()
RETURNS SETOF RECORD
AS '$libdir/gp_instrument_shmem', 'gp_instrument_shmem_detail'
LANGUAGE C IMMUTABLE;

CREATE VIEW gp_instrument_shmem_detail AS
WITH all_entries AS (
  SELECT C.* FROM __gp_localid, gp_instrument_shmem_detail_f() AS C (
    tmid int4, ssid int4, ccnt int2, segid int2, pid int4,
    nid int2, tuplecount int8, nloops int8, ntuples int8
  )
  UNION ALL
  SELECT C.* FROM __gp_masterid, gp_instrument_shmem_detail_f() AS C (
    tmid int4, ssid int4, ccnt int2, segid int2, pid int4,
    nid int2, tuplecount int8, nloops int8, ntuples int8
  ))
SELECT * FROM all_entries ORDER BY segid;

GRANT SELECT ON gp_instrument_shmem_detail TO public;
`

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

// PlanShmemDetailForSession returns the real plan tree captured at query
// start by the kernel's GpCapturePlanShmem (WHPG-only; see
// service.Capabilities.RealPlanShmem) — one row per (segment, plan node)
// with the true plan_node_id/parent_nid/node_type, no re-EXPLAIN and no
// client-side node-numbering needed. Same ccnt-filtering rationale as
// InstrumentationDetailForSession. $1 = sess_id.
const PlanShmemDetailForSession = `
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
    plan_rows
FROM query_metrics.gp_plan_shmem_detail
WHERE ssid = $1
  AND ccnt = (SELECT max(ccnt) FROM query_metrics.gp_plan_shmem_detail WHERE ssid = $1)
ORDER BY segid, nid`

// SessIDForPid resolves a pg_stat_activity.pid to its sess_id, the key
// InstrumentationDetailForSession/SessionMemoryForSession filter on.
// $1 = pid.
const SessIDForPid = `SELECT sess_id FROM pg_stat_activity WHERE pid = $1`

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

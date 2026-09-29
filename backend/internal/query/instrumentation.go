package query

// InstrumentationDetailForSession returns live per-node, per-segment
// execution stats for one running query, sourced from
// whpg_plan_tree.instrument_detail — a thin SQL wrapper (installed by
// CREATE EXTENSION whpg_plan_tree) around GPDB's shared-memory
// query-metrics ring (gp_enable_query_metrics). nid is the plan
// node's plan_node_id; ntuples/tuplecount/nloops are rows produced so
// far. $1 = sess_id (pg_stat_activity.sess_id). ccnt (command count)
// isn't exposed on pg_stat_activity and isn't needed anyway — a
// session only ever has one command actively executing, so its slots
// all share the same (highest) ccnt; filtering to max(ccnt) picks
// that one and ignores any not-yet-recycled slots from an earlier
// command in the same session.
const InstrumentationDetailForSession = `
SELECT
    segid,
    pid,
    nid,
    tuplecount,
    nloops,
    ntuples
FROM whpg_plan_tree.instrument_detail
WHERE ssid = $1
  AND ccnt = (SELECT max(ccnt) FROM whpg_plan_tree.instrument_detail WHERE ssid = $1)
ORDER BY segid, nid`

// PlanTreeDetailForSession returns the real plan tree captured at query
// start by the whpg_plan_tree extension (WHPG7/GPDB7, Cloudberry and
// other GPDB-lineage cores; see service.Capabilities.RealPlanShmem) — one row per
// (segment, plan node) with the true plan_node_id/parent_nid/node_type,
// no re-EXPLAIN and no client-side node-numbering needed. Same
// ccnt-filtering rationale as InstrumentationDetailForSession.
// $1 = sess_id.
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
FROM whpg_plan_tree.plan_detail
WHERE ssid = $1
  AND ccnt = (SELECT max(ccnt) FROM whpg_plan_tree.plan_detail WHERE ssid = $1)
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

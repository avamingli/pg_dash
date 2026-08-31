package handler

import (
	"net/http"
	"strconv"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterInstrumentationRoutes(r chi.Router, pool *pgxpool.Pool, connMgr *service.ConnectionManager) {
	r.Get("/queries/{pid}/progress", queryProgressHandler(pool, connMgr))
}

// queryProgressHandler returns a live snapshot of per-segment, per-plan-node
// row progress (and, if available, per-segment memory) for one running
// backend. Meant to be polled at a short interval (~500ms-1s) while a
// "Watch" panel is open — see query/instrumentation.go for the underlying
// gp_instrument_shmem/gp_internal_tools mechanism this reads from.
func queryProgressHandler(pool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pid, err := strconv.Atoi(chi.URLParam(r, "pid"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid pid")
			return
		}
		sql := r.URL.Query().Get("sql")

		// The live query plan tree needs both capabilities: QueryMetrics for
		// the live per-node row counts (gp_instrument_shmem_detail) and
		// RealPlanShmem for the real tree structure itself
		// (plan_tree_detail). Deliberately refusing the whole endpoint
		// rather than degrading to an EXPLAIN-based reconstruction when only
		// one is present — a guessed tree isn't the query that's actually
		// running, so the feature is either fully available or hidden.
		caps := connMgr.GetCapabilities()
		if !caps.QueryMetrics {
			writeError(w, http.StatusServiceUnavailable,
				"gp_enable_query_metrics is not enabled or query_metrics.gp_instrument_shmem_detail "+
					"hasn't been set up. One-time setup:\n"+
					"1. gpconfig -c gp_enable_query_metrics -v on && gpstop -raf\n"+
					"2. Run this SQL once:\n"+query.InstrumentationSetupDDL)
			return
		}
		if !caps.RealPlanShmem {
			writeError(w, http.StatusServiceUnavailable,
				"the whpg_plan_tree extension is not installed. One-time setup:\n"+
					"1. gpconfig -c shared_preload_libraries -v whpg_plan_tree --skipvalidation && gpstop -raf\n"+
					"   (append to any existing shared_preload_libraries value instead, if one is set)\n"+
					"2. CREATE EXTENSION whpg_plan_tree;")
			return
		}

		ctx := r.Context()

		// If the caller tells us which SQL it's watching, also verify that
		// pid is still actively running it — a bare pid match isn't enough
		// once the connection can be handed back to pg_dash's own pool and
		// picked up by an unrelated query (see SessIDForPidRunning).
		sessIDQuery, args := query.SessIDForPid, []any{pid}
		if sql != "" {
			sessIDQuery, args = query.SessIDForPidRunning, []any{pid, sql}
		}

		var sessID int
		if err := pool.QueryRow(ctx, sessIDQuery, args...).Scan(&sessID); err != nil {
			writeError(w, http.StatusNotFound, "no active backend with that pid")
			return
		}

		nodes, err := queryRows(ctx, pool, query.InstrumentationDetailForSession, sessID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		result := map[string]interface{}{
			"pid":     pid,
			"sess_id": sessID,
			"nodes":   nodes,
		}

		if caps.SessionMemoryStats {
			mem, err := queryRows(ctx, pool, query.SessionMemoryForSession, sessID)
			if err == nil {
				result["memory"] = mem
			}
		}

		// The real plan tree, keyed by the true plan_node_id — already
		// required (caps.RealPlanShmem checked above), so this always runs.
		plan, err := queryRows(ctx, pool, query.PlanTreeDetailForSession, sessID)
		if err == nil {
			result["plan"] = plan
		}

		writeJSON(w, result)
	}
}

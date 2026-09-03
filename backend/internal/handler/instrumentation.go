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
		// the live per-node row counts (whpg_plan_tree.instrument_detail)
		// and RealPlanShmem for the real tree structure itself
		// (whpg_plan_tree.plan_detail). Deliberately refusing the whole
		// endpoint rather than degrading to an EXPLAIN-based reconstruction
		// when only one is present — a guessed tree isn't the query that's
		// actually running, so the feature is either fully available or
		// hidden. Both views ship together in the whpg_plan_tree extension
		// now, so a single CREATE EXTENSION step turns everything on.
		caps := connMgr.GetCapabilities()
		if !caps.QueryMetrics || !caps.RealPlanShmem {
			writeError(w, http.StatusServiceUnavailable,
				"live plan tree unavailable — verify: "+
					"(1) shared_preload_libraries contains whpg_plan_tree, "+
					"(2) gp_enable_query_metrics = on (both need gpstop -raf), "+
					"(3) CREATE EXTENSION whpg_plan_tree has run in this database.")
			return
		}

		ctx := r.Context()

		// Two ways to double-check that `pid` is still running the query
		// the caller wants to watch (not a random unrelated query that
		// grabbed the same pid off pg_dash's pool between polls):
		//   * tag → precise match against pg_stat_activity.application_name
		//     that the SQL Editor set on the conn before running the SQL
		//   * sql → substring match against pg_stat_activity.query
		//     (older path, fragile against read-only-wrap and multi-
		//     statement batch reformatting — kept as fallback)
		// Bare pid-only lookup as a last resort (e.g. Activity Monitor's
		// "watch that stranger's query" flow, where no tag exists).
		tag := r.URL.Query().Get("tag")
		sessIDQuery, args := query.SessIDForPid, []any{pid}
		if tag != "" {
			sessIDQuery, args = query.SessIDForPidByAppName, []any{pid, applicationNameFor(tag)}
		} else if sql != "" {
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

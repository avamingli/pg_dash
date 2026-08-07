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

		caps := connMgr.GetCapabilities()
		if !caps.QueryMetrics {
			writeError(w, http.StatusServiceUnavailable,
				"gp_enable_query_metrics is not enabled or query_metrics.gp_instrument_shmem_detail "+
					"hasn't been set up. One-time setup:\n"+
					"1. gpconfig -c gp_enable_query_metrics -v on && gpstop -raf\n"+
					"2. Run this SQL once:\n"+query.InstrumentationSetupDDL)
			return
		}

		ctx := r.Context()

		var sessID int
		if err := pool.QueryRow(ctx, query.SessIDForPid, pid).Scan(&sessID); err != nil {
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

		writeJSON(w, result)
	}
}

package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterActivityRoutes(r chi.Router, pool *pgxpool.Pool, connMgr *service.ConnectionManager) {
	r.Get("/activity", activityListHandler(pool, connMgr))
	r.Get("/activity/summary", activitySummaryHandler(pool))
	r.Get("/activity/long-running", longRunningHandler(pool, connMgr))
	r.Get("/activity/blocked", blockedHandler(pool, connMgr))
	r.Post("/activity/{pid}/cancel", cancelBackendHandler(pool))
	r.Post("/activity/{pid}/terminate", terminateBackendHandler(pool))
}

func activityListHandler(pool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caps := connMgr.GetCapabilities()
		sql := query.ActiveConnectionsLegacy
		switch {
		case caps.ActivityQueryID:
			sql = query.ActiveConnections
		case !caps.ActivityWaitEvent:
			sql = query.ActiveConnectionsPre96
		}
		rows, err := queryRows(r.Context(), pool, sql)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func activitySummaryHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		byState, err := queryRows(ctx, pool, query.ConnectionCountsByState)
		if err == nil {
			result["by_state"] = byState
		}
		byDB, err := queryRows(ctx, pool, query.ConnectionCountsByDatabase)
		if err == nil {
			result["by_database"] = byDB
		}
		byUser, err := queryRows(ctx, pool, query.ConnectionCountsByUser)
		if err == nil {
			result["by_user"] = byUser
		}

		var maxConns int
		if err := pool.QueryRow(ctx, query.MaxConnections).Scan(&maxConns); err == nil {
			result["max_connections"] = maxConns
		}

		writeJSON(w, result)
	}
}

func longRunningHandler(pool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		threshold := r.URL.Query().Get("threshold")
		if threshold == "" {
			threshold = "5 seconds"
		}
		sql := query.LongRunningQueries
		if !connMgr.GetCapabilities().ActivityWaitEvent {
			sql = query.LongRunningQueriesPre96
		}
		rows, err := queryRows(r.Context(), pool, sql, threshold)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func blockedHandler(pool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sql := query.BlockedQueries
		if !connMgr.GetCapabilities().ActivityWaitEvent {
			sql = query.BlockedQueriesPre96
		}
		rows, err := queryRows(r.Context(), pool, sql)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func cancelBackendHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pidStr := chi.URLParam(r, "pid")
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid pid: %s", pidStr))
			return
		}
		var success bool
		err = pool.QueryRow(r.Context(), query.CancelBackend, pid).Scan(&success)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{"success": success, "pid": pid})
	}
}

func terminateBackendHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pidStr := chi.URLParam(r, "pid")
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid pid: %s", pidStr))
			return
		}
		var success bool
		err = pool.QueryRow(r.Context(), query.TerminateBackend, pid).Scan(&success)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{"success": success, "pid": pid})
	}
}

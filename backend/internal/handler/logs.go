package handler

import (
	"net/http"
	"strconv"

	"github.com/avamingli/dbhouse-web/backend/internal/monitor"
	"github.com/go-chi/chi/v5"
)

func RegisterLogRoutes(r chi.Router, agg *monitor.Aggregator) {
	r.Get("/logs/stats", logStatsHandler(agg))
	r.Get("/logs/entries", logEntriesHandler(agg))
}

func logStatsHandler(agg *monitor.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		latest := agg.GetLatest()
		if latest == nil || latest.PG == nil || latest.PG.LogStats == nil {
			writeJSON(w, map[string]interface{}{
				"available": false,
				"message":   "No log data available yet.",
			})
			return
		}
		writeJSON(w, latest.PG.LogStats)
	}
}

var validSeverities = map[string]bool{
	"PANIC": true, "FATAL": true, "ERROR": true, "WARNING": true,
}

func logEntriesHandler(agg *monitor.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		severity := r.URL.Query().Get("severity")
		if severity != "" && !validSeverities[severity] {
			writeError(w, http.StatusBadRequest, "invalid severity: must be PANIC, FATAL, ERROR, or WARNING")
			return
		}

		limit := 200
		if l := r.URL.Query().Get("limit"); l != "" {
			if n, err := strconv.Atoi(l); err == nil && n > 0 {
				limit = n
			}
		}

		entries := agg.GetLogEntries(severity, limit)
		if entries == nil {
			writeJSON(w, []struct{}{})
			return
		}
		writeJSON(w, entries)
	}
}

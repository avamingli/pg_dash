package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/monitor"
	"github.com/go-chi/chi/v5"
)

func RegisterLogRoutes(r chi.Router, agg *monitor.Aggregator) {
	r.Get("/logs/stats", logStatsHandler(agg))
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

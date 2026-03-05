package handler

import (
	"net/http"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/monitor"
	"github.com/go-chi/chi/v5"
)

// RegisterMetricsRoutes sets up the metrics history endpoint.
func RegisterMetricsRoutes(r chi.Router, agg *monitor.Aggregator) {
	r.Get("/metrics/history", metricsHistoryHandler(agg))
	r.Get("/metrics/latest", metricsLatestHandler(agg))
}

func metricsHistoryHandler(agg *monitor.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		durationStr := r.URL.Query().Get("duration")
		if durationStr == "" {
			durationStr = "5m"
		}

		duration, err := time.ParseDuration(durationStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid duration: "+err.Error())
			return
		}

		history := agg.GetHistory(duration)
		writeJSON(w, history)
	}
}

func metricsLatestHandler(agg *monitor.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		latest := agg.GetLatest()
		if latest == nil {
			writeJSON(w, map[string]interface{}{})
			return
		}
		writeJSON(w, latest)
	}
}

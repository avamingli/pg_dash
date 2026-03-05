package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/monitor"
	"github.com/go-chi/chi/v5"
)

// RegisterSystemRoutes sets up system-level (OS) metric endpoints.
// These return the latest data from the aggregator's ring buffer.
func RegisterSystemRoutes(r chi.Router, agg *monitor.Aggregator) {
	r.Get("/system/cpu", systemMetricHandler(agg, "cpu"))
	r.Get("/system/memory", systemMetricHandler(agg, "memory"))
	r.Get("/system/disk", systemMetricHandler(agg, "disk"))
	r.Get("/system/disk/io", systemMetricHandler(agg, "disk_io"))
	r.Get("/system/network", systemMetricHandler(agg, "network"))
	r.Get("/system/processes", systemMetricHandler(agg, "processes"))
}

func systemMetricHandler(agg *monitor.Aggregator, metric string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		latest := agg.GetLatest()
		if latest == nil || latest.System == nil {
			writeJSON(w, map[string]interface{}{})
			return
		}

		sys := latest.System
		switch metric {
		case "cpu":
			if sys.CPU != nil {
				writeJSON(w, sys.CPU)
			} else {
				writeJSON(w, map[string]interface{}{})
			}
		case "memory":
			if sys.Memory != nil {
				writeJSON(w, sys.Memory)
			} else {
				writeJSON(w, map[string]interface{}{})
			}
		case "disk":
			writeJSON(w, sys.Disks)
		case "disk_io":
			writeJSON(w, sys.DiskIO)
		case "network":
			writeJSON(w, sys.Network)
		case "processes":
			writeJSON(w, sys.Processes)
		default:
			writeJSON(w, map[string]interface{}{})
		}
	}
}

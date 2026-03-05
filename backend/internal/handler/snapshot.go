package handler

import (
	"net/http"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
)

func RegisterSnapshotRoutes(r chi.Router, store *service.SnapshotStore) {
	r.Get("/snapshots", snapshotsHandler(store))
	r.Get("/snapshots/compare", snapshotsCompareHandler(store))
}

func snapshotsHandler(store *service.SnapshotStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fromStr := r.URL.Query().Get("from")
		toStr := r.URL.Query().Get("to")

		// Default: last 24 hours
		to := time.Now()
		from := to.Add(-24 * time.Hour)

		if fromStr != "" {
			if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
				from = t
			}
		}
		if toStr != "" {
			if t, err := time.Parse(time.RFC3339, toStr); err == nil {
				to = t
			}
		}

		snapshots := store.GetSnapshots(from, to)
		if snapshots == nil {
			writeJSON(w, []model.MetricsSnapshot{})
			return
		}
		writeJSON(w, snapshots)
	}
}

func snapshotsCompareHandler(store *service.SnapshotStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t1Str := r.URL.Query().Get("t1")
		t2Str := r.URL.Query().Get("t2")

		if t1Str == "" || t2Str == "" {
			writeError(w, http.StatusBadRequest, "t1 and t2 query parameters required (RFC3339 format)")
			return
		}

		t1, err := time.Parse(time.RFC3339, t1Str)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid t1 format: "+err.Error())
			return
		}
		t2, err := time.Parse(time.RFC3339, t2Str)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid t2 format: "+err.Error())
			return
		}

		result, err := store.CompareSnapshots(t1, t2)
		if err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}

		writeJSON(w, result)
	}
}

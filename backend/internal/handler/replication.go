package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterReplicationRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/replication/status", replicationStatusHandler(pool))
	r.Get("/replication/slots", replicationSlotsHandler(pool))
	r.Get("/replication/wal", walStatsHandler(pool))
}

func replicationStatusHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.ReplicationStatus)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func replicationSlotsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.ReplicationSlots)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func walStatsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		walStats, err := queryRow(ctx, pool, query.WALStats)
		if err == nil {
			result["stats"] = walStats
		}

		var currentLSN string
		if err := pool.QueryRow(ctx, query.CurrentWALLSN).Scan(&currentLSN); err == nil {
			result["current_lsn"] = currentLSN
		}

		var isRecovery bool
		if err := pool.QueryRow(ctx, query.WALIsRecovery).Scan(&isRecovery); err == nil {
			result["is_recovery"] = isRecovery
		}

		writeJSON(w, result)
	}
}

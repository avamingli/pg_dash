package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterCheckpointRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/checkpoint/stats", checkpointStatsHandler(pool))
}

func checkpointStatsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		checkpoint, err := queryRow(ctx, pool, query.CheckpointStats)
		if err == nil {
			result["checkpointer"] = checkpoint
		}

		bgwriter, err := queryRow(ctx, pool, query.BGWriterStats)
		if err == nil {
			result["bgwriter"] = bgwriter
		}

		writeJSON(w, result)
	}
}

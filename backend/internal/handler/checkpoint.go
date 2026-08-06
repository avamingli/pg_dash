package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterCheckpointRoutes(r chi.Router, pool *pgxpool.Pool, connMgr *service.ConnectionManager) {
	r.Get("/checkpoint/stats", checkpointStatsHandler(pool, connMgr))
}

func checkpointStatsHandler(pool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		sql := query.CheckpointStatsLegacy
		if connMgr.GetCapabilities().StatCheckpointer {
			sql = query.CheckpointStats
		}
		checkpoint, err := queryRow(ctx, pool, sql)
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

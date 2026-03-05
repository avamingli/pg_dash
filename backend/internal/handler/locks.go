package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterLockRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/locks", locksHandler(pool))
	r.Get("/locks/conflicts", lockConflictsHandler(pool))
}

func locksHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		locks, err := queryRows(ctx, pool, query.CurrentLocks)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		result["locks"] = locks

		summary, err := queryRows(ctx, pool, query.LockTypeSummary)
		if err == nil {
			result["summary"] = summary
		}

		writeJSON(w, result)
	}
}

func lockConflictsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		conflicts, err := queryRows(ctx, pool, query.LockConflicts)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		result["conflicts"] = conflicts

		chains, err := queryRows(ctx, pool, query.BlockingChains)
		if err == nil {
			result["blocking_chains"] = chains
		}

		writeJSON(w, result)
	}
}

package handler

import (
	"fmt"
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterVacuumRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/vacuum/progress", vacuumProgressHandler(pool))
	r.Get("/vacuum/workers", vacuumWorkersHandler(pool))
	r.Get("/vacuum/needed", vacuumNeededHandler(pool))
	r.Post("/vacuum/{schema}/{table}", triggerVacuumHandler(pool))
	r.Post("/vacuum/{schema}/{table}/analyze", triggerAnalyzeHandler(pool))
}

func vacuumProgressHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.VacuumProgress)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func vacuumWorkersHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.AutovacuumWorkers)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func vacuumNeededHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		tables, err := queryRows(ctx, pool, query.TablesNeedingVacuum)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		result["tables"] = tables

		settings, err := queryRows(ctx, pool, query.AutovacuumSettings)
		if err == nil {
			result["settings"] = settings
		}

		writeJSON(w, result)
	}
}

func triggerVacuumHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		schema := chi.URLParam(r, "schema")
		table := chi.URLParam(r, "table")

		// Use pgx identifier quoting to prevent SQL injection
		ident := pgx.Identifier{schema, table}.Sanitize()
		sql := fmt.Sprintf("VACUUM %s", ident)

		_, err := pool.Exec(r.Context(), sql)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{
			"status": "ok",
			"action": "vacuum",
			"table":  fmt.Sprintf("%s.%s", schema, table),
		})
	}
}

func triggerAnalyzeHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		schema := chi.URLParam(r, "schema")
		table := chi.URLParam(r, "table")

		ident := pgx.Identifier{schema, table}.Sanitize()
		sql := fmt.Sprintf("ANALYZE %s", ident)

		_, err := pool.Exec(r.Context(), sql)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{
			"status": "ok",
			"action": "analyze",
			"table":  fmt.Sprintf("%s.%s", schema, table),
		})
	}
}

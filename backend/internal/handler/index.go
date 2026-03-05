package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterIndexRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/indexes", indexListHandler(pool))
	r.Get("/indexes/unused", unusedIndexesHandler(pool))
	r.Get("/indexes/duplicate", duplicateIndexesHandler(pool))
	r.Get("/indexes/bloat", indexBloatHandler(pool))
}

func indexListHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.IndexList)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func unusedIndexesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.UnusedIndexes)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func duplicateIndexesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.DuplicateIndexes)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func indexBloatHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.IndexBloat)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

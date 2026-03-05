package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterDatabaseRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/databases", databaseListHandler(pool))
	r.Get("/databases/{name}/tables", databaseTablesHandler(pool))
	r.Get("/databases/{name}/tables/{table}/io", tableIOHandler(pool))
	r.Get("/databases/{name}/indexes", databaseIndexesHandler(pool))
}

func databaseListHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.DatabaseList)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func databaseTablesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Schema filter from query param, default to all schemas
		schema := r.URL.Query().Get("schema")
		if schema == "" {
			schema = "%"
		}
		rows, err := queryRows(r.Context(), pool, query.TableList, schema)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func tableIOHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		table := chi.URLParam(r, "table")
		schema := r.URL.Query().Get("schema")
		if schema == "" {
			schema = "public"
		}
		row, err := queryRow(r.Context(), pool, query.TableIOStats, schema, table)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, row)
	}
}

func databaseIndexesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.IndexList)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

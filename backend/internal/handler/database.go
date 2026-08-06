package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterDatabaseRoutes(r chi.Router, pool *pgxpool.Pool, connMgr *service.ConnectionManager) {
	r.Get("/databases", databaseListHandler(pool, connMgr))
	r.Get("/databases/{name}/tables", databaseTablesHandler(connMgr))
	r.Get("/databases/{name}/tables/{table}/io", tableIOHandler(connMgr))
	r.Get("/databases/{name}/tables/{table}/columns", tableColumnsHandler(connMgr))
	r.Get("/databases/{name}/tables/{table}/ddl", tableDDLHandler(connMgr))
	r.Get("/databases/{name}/tables/bloat", tableBloatHandler(connMgr))
	r.Get("/databases/{name}/indexes", databaseIndexesHandler(connMgr))
}

func databaseListHandler(pool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sql := query.DatabaseListLegacy
		if connMgr.GetCapabilities().DatabaseSessionStats {
			sql = query.DatabaseList
		}
		rows, err := queryRows(r.Context(), pool, sql)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func databaseTablesHandler(connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		dbPool, err := connMgr.GetPoolForDB(r.Context(), name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		schema := r.URL.Query().Get("schema")
		if schema == "" {
			schema = "%"
		}
		sql := query.TableListLegacy
		if connMgr.GetCapabilities().TableInsertsSinceVacuum {
			sql = query.TableList
		}
		rows, err := queryRows(r.Context(), dbPool, sql, schema)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func tableIOHandler(connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		dbPool, err := connMgr.GetPoolForDB(r.Context(), name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		table := chi.URLParam(r, "table")
		schema := r.URL.Query().Get("schema")
		if schema == "" {
			schema = "public"
		}
		row, err := queryRow(r.Context(), dbPool, query.TableIOStats, schema, table)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, row)
	}
}

func tableColumnsHandler(connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		dbPool, err := connMgr.GetPoolForDB(r.Context(), name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		table := chi.URLParam(r, "table")
		schema := r.URL.Query().Get("schema")
		if schema == "" {
			schema = "public"
		}
		rows, err := queryRows(r.Context(), dbPool, query.TableColumns, schema, table)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func tableDDLHandler(connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		dbPool, err := connMgr.GetPoolForDB(r.Context(), name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		table := chi.URLParam(r, "table")
		schema := r.URL.Query().Get("schema")
		if schema == "" {
			schema = "public"
		}
		row, err := queryRow(r.Context(), dbPool, query.TableDDL, schema, table)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, row)
	}
}

func tableBloatHandler(connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		dbPool, err := connMgr.GetPoolForDB(r.Context(), name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		rows, err := queryRows(r.Context(), dbPool, query.TableBloat)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func databaseIndexesHandler(connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		dbPool, err := connMgr.GetPoolForDB(r.Context(), name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		rows, err := queryRows(r.Context(), dbPool, query.IndexList)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

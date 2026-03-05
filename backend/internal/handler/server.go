package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterServerRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/server/info", serverInfoHandler(pool))
	r.Get("/server/config", serverConfigHandler(pool))
}

// serverInfoHandler returns version, uptime, and key server settings.
func serverInfoHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		result := make(map[string]interface{})

		// Version
		var version string
		if err := pool.QueryRow(ctx, query.ServerVersion).Scan(&version); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		result["version"] = version

		// Uptime
		uptime, err := queryRow(ctx, pool, query.ServerUptime)
		if err == nil {
			result["start_time"] = uptime["start_time"]
			result["uptime"] = uptime["uptime"]
		}

		// Key settings
		settings, err := queryRows(ctx, pool, query.ServerSettings)
		if err == nil {
			result["settings"] = settings
		}

		// Max connections
		var maxConns int
		if err := pool.QueryRow(ctx, query.MaxConnections).Scan(&maxConns); err == nil {
			result["max_connections"] = maxConns
		}

		writeJSON(w, result)
	}
}

// serverConfigHandler returns the full pg_settings view.
func serverConfigHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		rows, err := queryRows(ctx, pool, query.ServerPGConfig)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

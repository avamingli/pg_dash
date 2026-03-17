package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterServerRoutes(r chi.Router, pool *pgxpool.Pool, ci *service.ClusterInfo) {
	r.Get("/server/info", serverInfoHandler(pool, ci))
	r.Get("/server/config", serverConfigHandler(pool))
}

// serverInfoHandler returns version, uptime, and key server settings.
func serverInfoHandler(pool *pgxpool.Pool, ci *service.ClusterInfo) http.HandlerFunc {
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

		// Current user and connection info
		var dbUser string
		if err := pool.QueryRow(ctx, "SELECT current_user").Scan(&dbUser); err == nil {
			result["user"] = dbUser
		}
		var dbName string
		if err := pool.QueryRow(ctx, "SELECT current_database()").Scan(&dbName); err == nil {
			result["database"] = dbName
		}
		// Connection endpoint: inet_server_addr and port
		var serverAddr, serverPort string
		_ = pool.QueryRow(ctx, "SELECT coalesce(host(inet_server_addr()), 'localhost'), current_setting('port')").Scan(&serverAddr, &serverPort)
		if serverAddr != "" {
			result["host"] = serverAddr
			result["port"] = serverPort
		}

		// Max connections
		var maxConns int
		if err := pool.QueryRow(ctx, query.MaxConnections).Scan(&maxConns); err == nil {
			result["max_connections"] = maxConns
		}

		// Cluster info (nil for vanilla PostgreSQL)
		if ci != nil {
			result["cluster_info"] = ci
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

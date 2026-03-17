package handler

import (
	"net/http"
	"strconv"

	"github.com/avamingli/dbhouse-web/backend/internal/monitor"
	pgmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/pg"
	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RegisterClusterRoutes registers /cluster/* routes (only for distributed clusters).
func RegisterClusterRoutes(r chi.Router, pool *pgxpool.Pool, agg *monitor.Aggregator, ci *service.ClusterInfo) {
	gpc := agg.GetClusterCollector()
	if gpc == nil {
		return
	}

	r.Route("/cluster", func(r chi.Router) {
		r.Get("/info", clusterInfoHandler(ci))
		r.Get("/topology", clusterTopologyHandler(gpc))
		r.Get("/health", clusterHealthHandler(agg))
		r.Get("/replication", clusterReplicationHandler(agg))
		r.Get("/history", clusterHistoryHandler(gpc))

		r.Get("/segments/stats", segmentStatsHandler(gpc))
		r.Get("/segments/disk", segmentDiskHandler(gpc))

		r.Get("/resource/queues", resourceQueueHandler(gpc, ci))
		r.Get("/resource/groups", resourceGroupStatusHandler(gpc, ci))
		r.Get("/resource/config", resourceGroupConfigHandler(gpc, ci))

		r.Get("/workfiles", workfileEntriesHandler(pool))
		r.Get("/workfiles/segments", workfileSegmentsHandler(gpc))

		r.Get("/skew", dataSkewHandler(gpc))
		r.Get("/config-diffs", configDiffsHandler(pool))
		r.Get("/hosts", perHostMetricsHandler(pool))
		r.Get("/tables/{schema}/{table}/distribution", tableDistributionHandler(pool))
	})
}

func clusterInfoHandler(ci *service.ClusterInfo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, ci)
	}
}

func clusterTopologyHandler(gpc *pgmon.ClusterCollector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		segments, err := gpc.GetTopology(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, segments)
	}
}

func clusterHealthHandler(agg *monitor.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		latest := agg.GetLatest()
		if latest == nil || latest.Cluster == nil || latest.Cluster.ClusterHealth == nil {
			// Fall back to direct query
			gpc := agg.GetClusterCollector()
			if gpc == nil {
				writeError(w, http.StatusServiceUnavailable, "cluster collector not available")
				return
			}
			health, err := gpc.GetClusterHealth(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, health)
			return
		}
		writeJSON(w, latest.Cluster.ClusterHealth)
	}
}

func clusterReplicationHandler(agg *monitor.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		latest := agg.GetLatest()
		if latest != nil && latest.Cluster != nil && latest.Cluster.SegmentReplication != nil {
			writeJSON(w, latest.Cluster.SegmentReplication)
			return
		}
		gpc := agg.GetClusterCollector()
		if gpc == nil {
			writeJSON(w, []struct{}{})
			return
		}
		repl, err := gpc.GetSegmentReplication(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, repl)
	}
}

func clusterHistoryHandler(gpc *pgmon.ClusterCollector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if n, err := strconv.Atoi(l); err == nil && n > 0 {
				limit = n
			}
		}
		entries, err := gpc.GetConfigHistory(r.Context(), limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if entries == nil {
			writeJSON(w, []struct{}{})
			return
		}
		writeJSON(w, entries)
	}
}

func segmentStatsHandler(gpc *pgmon.ClusterCollector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats, err := gpc.GetPerSegmentStats(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, stats)
	}
}

func segmentDiskHandler(gpc *pgmon.ClusterCollector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		disk, err := gpc.GetDiskFree(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, disk)
	}
}

func resourceQueueHandler(gpc *pgmon.ClusterCollector, ci *service.ClusterInfo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ci.ResourceMgr != "queue" {
			writeJSON(w, map[string]string{"message": "resource manager is not 'queue'"})
			return
		}
		queues, err := gpc.GetResourceQueueStatus(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, queues)
	}
}

func resourceGroupStatusHandler(gpc *pgmon.ClusterCollector, ci *service.ClusterInfo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ci.ResourceMgr != "group" {
			writeJSON(w, map[string]string{"message": "resource manager is not 'group'"})
			return
		}
		groups, err := gpc.GetResourceGroupStatus(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, groups)
	}
}

func resourceGroupConfigHandler(gpc *pgmon.ClusterCollector, ci *service.ClusterInfo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ci.ResourceMgr != "group" {
			writeJSON(w, map[string]string{"message": "resource manager is not 'group'"})
			return
		}
		config, err := gpc.GetResourceGroupConfig(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, config)
	}
}

func workfileEntriesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, `
			SELECT segid AS gp_segment_id, prefix, size, optype, slice, numfiles
			FROM gp_toolkit.gp_workfile_entries ORDER BY size DESC
		`)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func workfileSegmentsHandler(gpc *pgmon.ClusterCollector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		wf, err := gpc.GetWorkfileUsage(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, wf)
	}
}

func dataSkewHandler(gpc *pgmon.ClusterCollector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		skew, err := gpc.GetDataSkew(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if skew == nil {
			writeJSON(w, []struct{}{})
			return
		}
		writeJSON(w, skew)
	}
}

func perHostMetricsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, query.PerHostMetrics)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

func tableDistributionHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		schema := chi.URLParam(r, "schema")
		table := chi.URLParam(r, "table")
		row, err := queryRow(r.Context(), pool, query.TableDistributionPolicy, schema, table)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, row)
	}
}

func configDiffsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queryRows(r.Context(), pool, `
			SELECT psdname AS name, psdvalue AS value, psdcount AS count
			FROM gp_toolkit.gp_param_settings_seg_value_diffs ORDER BY psdname
		`)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

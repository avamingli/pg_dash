package pg

import (
	"context"
	"fmt"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ClusterCollector gathers distributed cluster-specific metrics (Cloudberry/CBDB).
type ClusterCollector struct {
	pool        *pgxpool.Pool
	clusterInfo *service.ClusterInfo
}

// NewClusterCollector creates a new cluster metrics collector.
func NewClusterCollector(pool *pgxpool.Pool, ci *service.ClusterInfo) *ClusterCollector {
	return &ClusterCollector{pool: pool, clusterInfo: ci}
}

// GetTopology returns all segments from gp_segment_configuration.
func (c *ClusterCollector) GetTopology(ctx context.Context) ([]model.SegmentInfo, error) {
	rows, err := c.pool.Query(ctx, query.ClusterTopology)
	if err != nil {
		return nil, fmt.Errorf("GetTopology: %w", err)
	}
	defer rows.Close()

	var result []model.SegmentInfo
	for rows.Next() {
		var s model.SegmentInfo
		if err := rows.Scan(
			&s.Dbid, &s.ContentID, &s.Role, &s.PreferredRole,
			&s.Mode, &s.Status, &s.Hostname, &s.Port, &s.DataDir,
			&s.IsCoordinator, &s.IsBalanced,
		); err != nil {
			return nil, fmt.Errorf("GetTopology: scan: %w", err)
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

// GetClusterHealth returns a single-row health summary.
func (c *ClusterCollector) GetClusterHealth(ctx context.Context) (*model.ClusterHealth, error) {
	h := &model.ClusterHealth{}
	err := c.pool.QueryRow(ctx, query.SegmentHealth).Scan(
		&h.PrimariesUp, &h.PrimariesDown,
		&h.MirrorsUp, &h.MirrorsDown,
		&h.Unbalanced, &h.NotSynchronized,
	)
	if err != nil {
		return nil, fmt.Errorf("GetClusterHealth: %w", err)
	}
	return h, nil
}

// GetSegmentReplication returns per-segment WAL replication status.
func (c *ClusterCollector) GetSegmentReplication(ctx context.Context) ([]model.SegmentReplication, error) {
	rows, err := c.pool.Query(ctx, query.SegmentReplication)
	if err != nil {
		return nil, fmt.Errorf("GetSegmentReplication: %w", err)
	}
	defer rows.Close()

	var result []model.SegmentReplication
	for rows.Next() {
		var r model.SegmentReplication
		if err := rows.Scan(
			&r.SegmentID, &r.State, &r.SyncState, &r.SyncError,
			&r.WriteLag, &r.FlushLag, &r.ReplayLag,
		); err != nil {
			return nil, fmt.Errorf("GetSegmentReplication: scan: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetConfigHistory returns recent FTS failover/recovery events.
func (c *ClusterCollector) GetConfigHistory(ctx context.Context, limit int) ([]model.ConfigHistoryEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := c.pool.Query(ctx, query.ConfigHistory, limit)
	if err != nil {
		return nil, fmt.Errorf("GetConfigHistory: %w", err)
	}
	defer rows.Close()

	var result []model.ConfigHistoryEntry
	for rows.Next() {
		var e model.ConfigHistoryEntry
		if err := rows.Scan(&e.Time, &e.Dbid, &e.Description); err != nil {
			return nil, fmt.Errorf("GetConfigHistory: scan: %w", err)
		}
		result = append(result, e)
	}
	return result, rows.Err()
}

// GetResourceQueueStatus returns resource queue limits and usage.
func (c *ClusterCollector) GetResourceQueueStatus(ctx context.Context) ([]model.ResourceQueueStatus, error) {
	rows, err := c.pool.Query(ctx, query.ResourceQueueStatus)
	if err != nil {
		return nil, fmt.Errorf("GetResourceQueueStatus: %w", err)
	}
	defer rows.Close()

	var result []model.ResourceQueueStatus
	for rows.Next() {
		var q model.ResourceQueueStatus
		if err := rows.Scan(
			&q.Name, &q.CountLimit, &q.CountValue,
			&q.CostLimit, &q.CostValue,
			&q.MemoryLimit, &q.MemoryValue,
			&q.Waiters, &q.Holders,
		); err != nil {
			return nil, fmt.Errorf("GetResourceQueueStatus: scan: %w", err)
		}
		result = append(result, q)
	}
	return result, rows.Err()
}

// GetResourceGroupStatus returns resource group runtime status.
func (c *ClusterCollector) GetResourceGroupStatus(ctx context.Context) ([]model.ResourceGroupStatus, error) {
	rows, err := c.pool.Query(ctx, query.ResourceGroupStatus)
	if err != nil {
		return nil, fmt.Errorf("GetResourceGroupStatus: %w", err)
	}
	defer rows.Close()

	var result []model.ResourceGroupStatus
	for rows.Next() {
		var g model.ResourceGroupStatus
		if err := rows.Scan(
			&g.GroupName, &g.NumRunning, &g.NumQueueing,
			&g.NumQueued, &g.NumExecuted, &g.TotalQueueDuration,
		); err != nil {
			return nil, fmt.Errorf("GetResourceGroupStatus: scan: %w", err)
		}
		result = append(result, g)
	}
	return result, rows.Err()
}

// GetResourceGroupConfig returns resource group configuration.
func (c *ClusterCollector) GetResourceGroupConfig(ctx context.Context) ([]model.ResourceGroupConfig, error) {
	rows, err := c.pool.Query(ctx, query.ResourceGroupConfig)
	if err != nil {
		return nil, fmt.Errorf("GetResourceGroupConfig: %w", err)
	}
	defer rows.Close()

	var result []model.ResourceGroupConfig
	for rows.Next() {
		var g model.ResourceGroupConfig
		if err := rows.Scan(
			&g.GroupName, &g.Concurrency, &g.CpuMaxPercent,
			&g.CpuWeight, &g.MemoryQuota, &g.MinCost, &g.IoLimit,
		); err != nil {
			return nil, fmt.Errorf("GetResourceGroupConfig: scan: %w", err)
		}
		result = append(result, g)
	}
	return result, rows.Err()
}

// GetPerSegmentStats returns per-segment database statistics.
func (c *ClusterCollector) GetPerSegmentStats(ctx context.Context) ([]model.PerSegmentStats, error) {
	rows, err := c.pool.Query(ctx, query.PerSegmentDBStats)
	if err != nil {
		return nil, fmt.Errorf("GetPerSegmentStats: %w", err)
	}
	defer rows.Close()

	var result []model.PerSegmentStats
	for rows.Next() {
		var s model.PerSegmentStats
		if err := rows.Scan(
			&s.SegmentID, &s.XactCommit, &s.XactRollback,
			&s.BlksRead, &s.BlksHit, &s.TempFiles, &s.TempBytes,
		); err != nil {
			return nil, fmt.Errorf("GetPerSegmentStats: scan: %w", err)
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

// GetWorkfileUsage returns workfile/spill usage per segment.
func (c *ClusterCollector) GetWorkfileUsage(ctx context.Context) ([]model.WorkfileUsage, error) {
	rows, err := c.pool.Query(ctx, query.WorkfileUsagePerSegment)
	if err != nil {
		return nil, fmt.Errorf("GetWorkfileUsage: %w", err)
	}
	defer rows.Close()

	var result []model.WorkfileUsage
	for rows.Next() {
		var w model.WorkfileUsage
		if err := rows.Scan(&w.SegmentID, &w.Size, &w.NumFiles); err != nil {
			return nil, fmt.Errorf("GetWorkfileUsage: scan: %w", err)
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

// GetDataSkew returns tables with notable data distribution skew. Expensive query.
func (c *ClusterCollector) GetDataSkew(ctx context.Context) ([]model.DataSkew, error) {
	rows, err := c.pool.Query(ctx, query.DataSkewCoefficients)
	if err != nil {
		return nil, fmt.Errorf("GetDataSkew: %w", err)
	}
	defer rows.Close()

	var result []model.DataSkew
	for rows.Next() {
		var d model.DataSkew
		if err := rows.Scan(&d.Schema, &d.TableName, &d.Coefficient); err != nil {
			return nil, fmt.Errorf("GetDataSkew: scan: %w", err)
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

// GetDiskFree returns disk free space per segment host.
func (c *ClusterCollector) GetDiskFree(ctx context.Context) ([]model.DiskFree, error) {
	rows, err := c.pool.Query(ctx, query.DiskFreePerSegment)
	if err != nil {
		return nil, fmt.Errorf("GetDiskFree: %w", err)
	}
	defer rows.Close()

	var result []model.DiskFree
	for rows.Next() {
		var d model.DiskFree
		if err := rows.Scan(&d.SegmentID, &d.Hostname, &d.Device, &d.Space); err != nil {
			return nil, fmt.Errorf("GetDiskFree: scan: %w", err)
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

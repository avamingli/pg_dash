package pg

import (
	"context"
	"fmt"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Collector gathers PostgreSQL-level metrics using pgx.
type Collector struct {
	pool *pgxpool.Pool
}

// NewCollector creates a new PG metrics collector.
func NewCollector(pool *pgxpool.Pool) *Collector {
	return &Collector{pool: pool}
}

// ConnectionSummary returns connection counts by state and max_connections.
func (c *Collector) ConnectionSummary(ctx context.Context) (*model.ConnectionSummary, error) {
	summary := &model.ConnectionSummary{}

	// Get max_connections
	err := c.pool.QueryRow(ctx, query.MaxConnections).Scan(&summary.MaxConnections)
	if err != nil {
		return nil, fmt.Errorf("ConnectionSummary: max_connections: %w", err)
	}

	// Get counts by state
	rows, err := c.pool.Query(ctx, query.ConnectionCountsByState)
	if err != nil {
		return nil, fmt.Errorf("ConnectionSummary: counts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var label string
		var count int
		if err := rows.Scan(&label, &count); err != nil {
			return nil, fmt.Errorf("ConnectionSummary: scan: %w", err)
		}
		summary.Total += count
		switch label {
		case "active":
			summary.Active = count
		case "idle":
			summary.Idle = count
		case "idle in transaction":
			summary.IdleInTransaction = count
		case "idle in transaction (aborted)":
			summary.IdleInTransaction += count
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ConnectionSummary: rows: %w", err)
	}

	// Waiting = blocked by locks
	var waiting int
	wRows, err := c.pool.Query(ctx, query.BlockedQueries)
	if err == nil {
		defer wRows.Close()
		for wRows.Next() {
			waiting++
		}
	}
	summary.Waiting = waiting

	return summary, nil
}

// TPS returns the current cumulative commit/rollback counters.
// The caller (aggregator) computes deltas between two calls to derive TPS.
func (c *Collector) TPS(ctx context.Context) (*model.TPSStats, error) {
	stats := &model.TPSStats{}
	err := c.pool.QueryRow(ctx, query.DatabaseTPS).Scan(&stats.Commits, &stats.Rollbacks)
	if err != nil {
		return nil, fmt.Errorf("TPS: %w", err)
	}
	return stats, nil
}

// CacheHitRatio returns the overall cache hit ratio percentage.
func (c *Collector) CacheHitRatio(ctx context.Context) (float64, error) {
	var ratio float64
	err := c.pool.QueryRow(ctx, query.DatabaseCacheHitRatio).Scan(&ratio)
	if err != nil {
		return 0, fmt.Errorf("CacheHitRatio: %w", err)
	}
	return ratio, nil
}

// DatabaseSizes returns all non-template databases with their sizes.
func (c *Collector) DatabaseSizes(ctx context.Context) ([]model.DatabaseSize, error) {
	rows, err := c.pool.Query(ctx, query.DatabaseSizes)
	if err != nil {
		return nil, fmt.Errorf("DatabaseSizes: %w", err)
	}
	defer rows.Close()

	var sizes []model.DatabaseSize
	for rows.Next() {
		var ds model.DatabaseSize
		if err := rows.Scan(&ds.Name, &ds.Size); err != nil {
			return nil, fmt.Errorf("DatabaseSizes: scan: %w", err)
		}
		sizes = append(sizes, ds)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("DatabaseSizes: rows: %w", err)
	}
	return sizes, nil
}

// CollectAll gathers all PG metrics in a single call.
func (c *Collector) CollectAll(ctx context.Context) (*model.PGMetrics, error) {
	metrics := &model.PGMetrics{}

	connSummary, err := c.ConnectionSummary(ctx)
	if err != nil {
		return nil, fmt.Errorf("CollectAll: %w", err)
	}
	metrics.Connections = connSummary

	tps, err := c.TPS(ctx)
	if err != nil {
		return nil, fmt.Errorf("CollectAll: %w", err)
	}
	metrics.TPS = tps

	cacheHit, err := c.CacheHitRatio(ctx)
	if err != nil {
		return nil, fmt.Errorf("CollectAll: %w", err)
	}
	metrics.CacheHitRatio = cacheHit

	dbSizes, err := c.DatabaseSizes(ctx)
	if err != nil {
		return nil, fmt.Errorf("CollectAll: %w", err)
	}
	metrics.DatabaseSizes = dbSizes

	return metrics, nil
}

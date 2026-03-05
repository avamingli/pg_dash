package pg

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		dsn = "postgres://gpadmin@127.0.0.1:17000/postgres"
	}

	var err error
	testPool, err = pgxpool.New(context.Background(), dsn)
	if err != nil {
		os.Exit(1)
	}
	defer testPool.Close()

	os.Exit(m.Run())
}

func TestConnectionSummary(t *testing.T) {
	c := NewCollector(testPool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	summary, err := c.ConnectionSummary(ctx)
	if err != nil {
		t.Fatalf("ConnectionSummary failed: %v", err)
	}

	if summary.MaxConnections == 0 {
		t.Error("expected non-zero MaxConnections")
	}
	if summary.Total == 0 {
		t.Error("expected non-zero Total connections")
	}
	t.Logf("Connections: total=%d active=%d idle=%d idle_in_tx=%d waiting=%d max=%d",
		summary.Total, summary.Active, summary.Idle, summary.IdleInTransaction,
		summary.Waiting, summary.MaxConnections)
}

func TestTPS(t *testing.T) {
	c := NewCollector(testPool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tps, err := c.TPS(ctx)
	if err != nil {
		t.Fatalf("TPS failed: %v", err)
	}

	// Commits should be > 0 on any active system
	t.Logf("TPS counters: commits=%d rollbacks=%d", tps.Commits, tps.Rollbacks)
}

func TestCacheHitRatio(t *testing.T) {
	c := NewCollector(testPool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ratio, err := c.CacheHitRatio(ctx)
	if err != nil {
		t.Fatalf("CacheHitRatio failed: %v", err)
	}

	t.Logf("Cache hit ratio: %.2f%%", ratio)
}

func TestDatabaseSizes(t *testing.T) {
	c := NewCollector(testPool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sizes, err := c.DatabaseSizes(ctx)
	if err != nil {
		t.Fatalf("DatabaseSizes failed: %v", err)
	}

	if len(sizes) == 0 {
		t.Fatal("expected at least one database")
	}

	for _, ds := range sizes {
		t.Logf("Database: %s  Size: %d MB", ds.Name, ds.Size/1024/1024)
	}
}

func TestCollectAll(t *testing.T) {
	c := NewCollector(testPool)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	metrics, err := c.CollectAll(ctx)
	if err != nil {
		t.Fatalf("CollectAll failed: %v", err)
	}

	if metrics.Connections == nil {
		t.Error("expected non-nil Connections")
	}
	if metrics.TPS == nil {
		t.Error("expected non-nil TPS")
	}
	if metrics.DatabaseSizes == nil {
		t.Error("expected non-nil DatabaseSizes")
	}

	t.Logf("PG Metrics: connections=%d cache_hit=%.2f%% dbs=%d",
		metrics.Connections.Total, metrics.CacheHitRatio, len(metrics.DatabaseSizes))
}

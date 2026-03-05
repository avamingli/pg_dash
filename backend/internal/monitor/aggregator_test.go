package monitor

import (
	"context"
	"os"
	"testing"
	"time"

	osmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/os"
	pgmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/pg"
	"github.com/avamingli/dbhouse-web/backend/internal/ws"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAggregatorRingBuffer(t *testing.T) {
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		dsn = "postgres://gpadmin@127.0.0.1:17000/postgres"
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("failed to connect to PG: %v", err)
	}
	defer pool.Close()

	hub := ws.NewHub()
	go hub.Run()

	pgCollector := pgmon.NewCollector(pool)
	osCollector := osmon.NewSystemCollectorWithPGData("/home/gpadmin/dbhouse/pg17")
	agg := NewAggregator(pgCollector, osCollector, hub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agg.Start(ctx)
	defer agg.Stop()

	// Wait for at least 3 collection cycles (2s each = ~6s + buffer)
	time.Sleep(7 * time.Second)

	count := agg.SnapshotCount()
	if count < 3 {
		t.Errorf("expected at least 3 snapshots, got %d", count)
	}
	t.Logf("Snapshot count: %d", count)

	// GetHistory should return all recent snapshots
	history := agg.GetHistory(0)
	if len(history) != count {
		t.Errorf("GetHistory(0) returned %d, expected %d", len(history), count)
	}

	// GetHistory with short duration
	recentHistory := agg.GetHistory(5 * time.Second)
	if len(recentHistory) == 0 {
		t.Error("expected non-empty recent history")
	}
	t.Logf("History (5s): %d snapshots", len(recentHistory))

	// GetLatest
	latest := agg.GetLatest()
	if latest == nil {
		t.Fatal("expected non-nil latest snapshot")
	}
	if latest.PG == nil {
		t.Error("expected PG metrics in latest snapshot")
	}
	if latest.System == nil {
		t.Error("expected System metrics in latest snapshot")
	}

	// Verify PG metrics
	if latest.PG != nil {
		if latest.PG.Connections == nil {
			t.Error("expected non-nil Connections")
		} else {
			t.Logf("PG Connections: total=%d max=%d",
				latest.PG.Connections.Total, latest.PG.Connections.MaxConnections)
		}
		t.Logf("PG CacheHit: %.2f%% DBs: %d", latest.PG.CacheHitRatio, len(latest.PG.DatabaseSizes))
	}

	// Verify OS metrics
	if latest.System != nil {
		if latest.System.CPU != nil {
			t.Logf("CPU: %.1f%% Load: %.2f", latest.System.CPU.UsagePercent, latest.System.CPU.LoadAvg1)
		}
		if latest.System.Memory != nil {
			t.Logf("Memory: %d MB used / %d MB total",
				latest.System.Memory.Used/1024/1024, latest.System.Memory.Total/1024/1024)
		}
		t.Logf("DiskIO devices: %d, Network interfaces: %d, PG processes: %d",
			len(latest.System.DiskIO), len(latest.System.Network), len(latest.System.Processes))
	}
}

func TestAggregatorStartStop(t *testing.T) {
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		dsn = "postgres://gpadmin@127.0.0.1:17000/postgres"
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("failed to connect to PG: %v", err)
	}
	defer pool.Close()

	hub := ws.NewHub()
	go hub.Run()

	pgCollector := pgmon.NewCollector(pool)
	osCollector := osmon.NewSystemCollectorWithPGData("/home/gpadmin/dbhouse/pg17")
	agg := NewAggregator(pgCollector, osCollector, hub, nil)

	if agg.IsRunning() {
		t.Error("aggregator should not be running before Start")
	}

	ctx := context.Background()
	agg.Start(ctx)

	time.Sleep(500 * time.Millisecond)
	if !agg.IsRunning() {
		t.Error("aggregator should be running after Start")
	}

	agg.Stop()
	time.Sleep(500 * time.Millisecond)
	if agg.IsRunning() {
		t.Error("aggregator should not be running after Stop")
	}
}

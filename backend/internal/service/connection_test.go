package service

import (
	"context"
	"os"
	"testing"
	"time"
)

func getTestDSN(t *testing.T) string {
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		t.Skip("PG_DSN not set, skipping integration test")
	}
	return dsn
}

func TestNewConnectionManager(t *testing.T) {
	dsn := getTestDSN(t)

	cm, err := NewConnectionManager(dsn)
	if err != nil {
		t.Fatalf("NewConnectionManager failed: %v", err)
	}
	defer cm.Close()

	if cm.Status() != StatusConnected {
		t.Errorf("expected status %q, got %q", StatusConnected, cm.Status())
	}

	if cm.GetPool() == nil {
		t.Error("expected non-nil pool")
	}
}

func TestNewConnectionManager_InvalidDSN(t *testing.T) {
	_, err := NewConnectionManager("postgres://baduser:badpass@127.0.0.1:1/nonexistent?connect_timeout=2")
	if err == nil {
		t.Fatal("expected error for invalid DSN, got nil")
	}
}

func TestTestConnection(t *testing.T) {
	dsn := getTestDSN(t)

	cm, err := NewConnectionManager(dsn)
	if err != nil {
		t.Fatalf("NewConnectionManager failed: %v", err)
	}
	defer cm.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	version, err := cm.TestConnection(ctx)
	if err != nil {
		t.Fatalf("TestConnection failed: %v", err)
	}

	if version == "" {
		t.Error("expected non-empty version string")
	}
	t.Logf("PostgreSQL version: %s", version)

	// Version should be cached
	if cm.Version() != version {
		t.Errorf("cached version %q != returned version %q", cm.Version(), version)
	}
}

func TestGetServerStartTime(t *testing.T) {
	dsn := getTestDSN(t)

	cm, err := NewConnectionManager(dsn)
	if err != nil {
		t.Fatalf("NewConnectionManager failed: %v", err)
	}
	defer cm.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	startTime, err := cm.GetServerStartTime(ctx)
	if err != nil {
		t.Fatalf("GetServerStartTime failed: %v", err)
	}

	if startTime.IsZero() {
		t.Error("expected non-zero start time")
	}
	t.Logf("Server start time: %s", startTime)

	// Second call should return cached value
	startTime2, err := cm.GetServerStartTime(ctx)
	if err != nil {
		t.Fatalf("GetServerStartTime (cached) failed: %v", err)
	}
	if !startTime.Equal(startTime2) {
		t.Errorf("cached start time %v != first call %v", startTime2, startTime)
	}
}

func TestPoolStats(t *testing.T) {
	dsn := getTestDSN(t)

	cm, err := NewConnectionManager(dsn)
	if err != nil {
		t.Fatalf("NewConnectionManager failed: %v", err)
	}
	defer cm.Close()

	stats := cm.PoolStats()
	if stats == nil {
		t.Fatal("expected non-nil pool stats")
	}
	t.Logf("Pool stats: total=%d, idle=%d, in-use=%d",
		stats.TotalConns(), stats.IdleConns(), stats.AcquiredConns())

	if stats.TotalConns() == 0 {
		t.Error("expected at least 1 total connection")
	}
}

func TestCloseAndStatus(t *testing.T) {
	dsn := getTestDSN(t)

	cm, err := NewConnectionManager(dsn)
	if err != nil {
		t.Fatalf("NewConnectionManager failed: %v", err)
	}

	if cm.Status() != StatusConnected {
		t.Errorf("expected connected, got %q", cm.Status())
	}

	cm.Close()

	if cm.Status() != StatusDisconnected {
		t.Errorf("expected disconnected after close, got %q", cm.Status())
	}
}

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

func TestClassifyVersionString(t *testing.T) {
	tests := []struct {
		name        string
		version     string
		wantMode    ClusterMode
		wantProduct string
		wantVersion string
		wantPGVer   string
	}{
		{
			name:        "plain PostgreSQL",
			version:     "PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 13.2.1, 64-bit",
			wantMode:    ModePostgreSQL,
			wantProduct: "PostgreSQL",
			wantVersion: "",
			wantPGVer:   "16.4",
		},
		{
			name:        "Apache Cloudberry",
			version:     "PostgreSQL 14.4 (Apache Cloudberry 2.0.0-devel build dev) on x86_64-pc-linux-gnu, compiled by gcc (GCC) 11.5.0, 64-bit",
			wantMode:    ModeCloudberry,
			wantProduct: "Apache Cloudberry",
			wantVersion: "2.0.0-devel",
			wantPGVer:   "14.4",
		},
		{
			name:        "Greenplum Database",
			version:     "PostgreSQL 12.12 (Greenplum Database 7.0.0-beta.0 build dev) on x86_64-pc-linux-gnu, compiled by gcc (GCC) 11.5.0, 64-bit",
			wantMode:    ModeCloudberry,
			wantProduct: "Greenplum Database",
			wantVersion: "7.0.0-beta.0",
			wantPGVer:   "12.12",
		},
		{
			// Captured live from a running WarehousePG dev cluster (whpg-dev-1, PGPORT 7000).
			name:        "WarehousePG",
			version:     "PostgreSQL 12.12 (Greenplum Database 7.0.0-beta.0 build dev) on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 11.5.0 20240719 (Red Hat 11.5.0-14), 64-bit compiled on Jul 13 2026 13:16:41 (with assert checking) Bhuvnesh C. WarehousePG",
			wantMode:    ModeWarehousePG,
			wantProduct: "WarehousePG",
			wantVersion: "7.0.0-beta.0",
			wantPGVer:   "12.12",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ci := classifyVersionString(tt.version)
			if ci.Mode != tt.wantMode {
				t.Errorf("Mode = %q, want %q", ci.Mode, tt.wantMode)
			}
			if ci.ProductName != tt.wantProduct {
				t.Errorf("ProductName = %q, want %q", ci.ProductName, tt.wantProduct)
			}
			if ci.Version != tt.wantVersion {
				t.Errorf("Version = %q, want %q", ci.Version, tt.wantVersion)
			}
			if ci.PGVersion != tt.wantPGVer {
				t.Errorf("PGVersion = %q, want %q", ci.PGVersion, tt.wantPGVer)
			}
		})
	}
}

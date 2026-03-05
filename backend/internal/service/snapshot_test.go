package service

import (
	"os"
	"testing"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
)

func makeSnapshot(ts time.Time) *model.MetricsSnapshot {
	return &model.MetricsSnapshot{
		Timestamp: ts,
		PG: &model.PGMetrics{
			CacheHitRatio: 99.5,
			Connections: &model.ConnectionSummary{
				Total:          42,
				MaxConnections: 100,
			},
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 55.2},
			Memory: &model.MemoryStats{UsedPercent: 72.1, Total: 16 * 1024 * 1024 * 1024},
		},
	}
}

func TestNewSnapshotStore(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSnapshotStore(dir, func() *model.MetricsSnapshot { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if store == nil {
		t.Fatal("store is nil")
	}
}

func TestNewSnapshotStore_BadDir(t *testing.T) {
	_, err := NewSnapshotStore("/proc/nonexistent/path", nil)
	if err == nil {
		t.Fatal("expected error for invalid directory")
	}
}

func TestSnapshotStore_TakeAndGet(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	snap := makeSnapshot(now)

	store, err := NewSnapshotStore(dir, func() *model.MetricsSnapshot { return snap })
	if err != nil {
		t.Fatal(err)
	}

	// Manually trigger snapshot
	store.takeSnapshot()

	// Retrieve
	results := store.GetSnapshots(now.Add(-time.Minute), now.Add(time.Minute))
	if len(results) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(results))
	}
	if results[0].PG.CacheHitRatio != 99.5 {
		t.Errorf("expected cache hit ratio 99.5, got %f", results[0].PG.CacheHitRatio)
	}
}

func TestSnapshotStore_MultipleSnapshots(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	idx := 0
	times := []time.Time{
		now,
		now.Add(5 * time.Minute),
		now.Add(10 * time.Minute),
	}

	store, err := NewSnapshotStore(dir, func() *model.MetricsSnapshot {
		if idx >= len(times) {
			return nil
		}
		snap := makeSnapshot(times[idx])
		idx++
		return snap
	})
	if err != nil {
		t.Fatal(err)
	}

	store.takeSnapshot()
	store.takeSnapshot()
	store.takeSnapshot()

	results := store.GetSnapshots(now.Add(-time.Minute), now.Add(15*time.Minute))
	if len(results) != 3 {
		t.Fatalf("expected 3 snapshots, got %d", len(results))
	}

	// Verify sorted by time
	for i := 1; i < len(results); i++ {
		if results[i].Timestamp.Before(results[i-1].Timestamp) {
			t.Error("snapshots should be sorted by timestamp")
		}
	}
}

func TestSnapshotStore_GetSnapshots_RangeFilter(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	idx := 0
	times := []time.Time{
		now,
		now.Add(5 * time.Minute),
		now.Add(10 * time.Minute),
	}

	store, err := NewSnapshotStore(dir, func() *model.MetricsSnapshot {
		if idx >= len(times) {
			return nil
		}
		snap := makeSnapshot(times[idx])
		idx++
		return snap
	})
	if err != nil {
		t.Fatal(err)
	}

	store.takeSnapshot()
	store.takeSnapshot()
	store.takeSnapshot()

	// Only get middle snapshot
	results := store.GetSnapshots(now.Add(3*time.Minute), now.Add(7*time.Minute))
	if len(results) != 1 {
		t.Fatalf("expected 1 snapshot in range, got %d", len(results))
	}
}

func TestSnapshotStore_CompareSnapshots(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	idx := 0
	snaps := []*model.MetricsSnapshot{
		{
			Timestamp: now,
			PG: &model.PGMetrics{
				CacheHitRatio: 99.0,
				Connections:   &model.ConnectionSummary{Total: 40, MaxConnections: 100},
			},
			System: &model.OSMetrics{
				CPU:    &model.CPUStats{UsagePercent: 50},
				Memory: &model.MemoryStats{UsedPercent: 70},
			},
		},
		{
			Timestamp: now.Add(10 * time.Minute),
			PG: &model.PGMetrics{
				CacheHitRatio: 99.5,
				Connections:   &model.ConnectionSummary{Total: 60, MaxConnections: 100},
			},
			System: &model.OSMetrics{
				CPU:    &model.CPUStats{UsagePercent: 80},
				Memory: &model.MemoryStats{UsedPercent: 75},
			},
		},
	}

	store, err := NewSnapshotStore(dir, func() *model.MetricsSnapshot {
		if idx >= len(snaps) {
			return nil
		}
		s := snaps[idx]
		idx++
		return s
	})
	if err != nil {
		t.Fatal(err)
	}

	store.takeSnapshot()
	store.takeSnapshot()

	result, err := store.CompareSnapshots(now, now.Add(10*time.Minute))
	if err != nil {
		t.Fatal(err)
	}

	delta, ok := result["delta"].(map[string]interface{})
	if !ok {
		t.Fatal("expected delta in result")
	}
	if delta["cache_hit_ratio_change"] != 0.5 {
		t.Errorf("expected cache_hit_ratio_change 0.5, got %v", delta["cache_hit_ratio_change"])
	}
}

func TestSnapshotStore_NilSnapshot(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSnapshotStore(dir, func() *model.MetricsSnapshot { return nil })
	if err != nil {
		t.Fatal(err)
	}

	// Should not panic
	store.takeSnapshot()

	results := store.GetSnapshots(time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if len(results) != 0 {
		t.Errorf("expected 0 snapshots for nil getter, got %d", len(results))
	}
}

func TestSnapshotStore_Cleanup(t *testing.T) {
	dir := t.TempDir()
	// Create an old file
	oldTime := time.Now().Add(-8 * 24 * time.Hour) // 8 days ago
	oldName := oldTime.Format("2006-01-02T15") + ".json"
	os.WriteFile(dir+"/"+oldName, []byte("[]"), 0644)

	// Create a recent file
	recentName := time.Now().Format("2006-01-02T15") + ".json"
	os.WriteFile(dir+"/"+recentName, []byte("[]"), 0644)

	store, _ := NewSnapshotStore(dir, func() *model.MetricsSnapshot { return nil })
	store.cleanup()

	// Old file should be removed
	if _, err := os.Stat(dir + "/" + oldName); !os.IsNotExist(err) {
		t.Error("expected old snapshot file to be cleaned up")
	}

	// Recent file should still exist
	if _, err := os.Stat(dir + "/" + recentName); err != nil {
		t.Error("expected recent snapshot file to be kept")
	}
}

func TestSnapshotStore_FileForTime(t *testing.T) {
	dir := t.TempDir()
	store, _ := NewSnapshotStore(dir, nil)

	ts := time.Date(2026, 3, 3, 14, 30, 0, 0, time.UTC)
	path := store.fileForTime(ts)
	expected := dir + "/2026-03-03T14.json"
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

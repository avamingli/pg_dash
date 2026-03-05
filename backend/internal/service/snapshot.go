package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/rs/zerolog/log"
)

const (
	// SnapshotInterval is how often snapshots are taken.
	SnapshotInterval = 5 * time.Minute

	// SnapshotRetention is how long snapshots are kept.
	SnapshotRetention = 7 * 24 * time.Hour

	// snapshotsPerFile groups snapshots by hour.
	snapshotsPerFile = time.Hour
)

// SnapshotStore persists MetricsSnapshots to disk as JSON files.
// Files are organized by hour: snapshots/2026-03-03T14.json
type SnapshotStore struct {
	mu      sync.RWMutex
	dir     string
	ticker  *time.Ticker
	stopCh  chan struct{}
	getFn   func() *model.MetricsSnapshot // function to get current snapshot
}

// NewSnapshotStore creates a snapshot store writing to the given directory.
func NewSnapshotStore(dir string, getFn func() *model.MetricsSnapshot) (*SnapshotStore, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("NewSnapshotStore: %w", err)
	}
	return &SnapshotStore{
		dir:   dir,
		getFn: getFn,
	}, nil
}

// Start begins periodic snapshot collection.
func (s *SnapshotStore) Start() {
	s.ticker = time.NewTicker(SnapshotInterval)
	s.stopCh = make(chan struct{})

	// Take one immediately
	s.takeSnapshot()

	go func() {
		for {
			select {
			case <-s.ticker.C:
				s.takeSnapshot()
				s.cleanup()
			case <-s.stopCh:
				s.ticker.Stop()
				return
			}
		}
	}()

	log.Info().Str("dir", s.dir).Msg("snapshot store started (5m interval, 7d retention)")
}

// Stop halts snapshot collection.
func (s *SnapshotStore) Stop() {
	if s.stopCh != nil {
		close(s.stopCh)
	}
}

func (s *SnapshotStore) takeSnapshot() {
	snap := s.getFn()
	if snap == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	filePath := s.fileForTime(snap.Timestamp)

	// Read existing snapshots from file
	var snapshots []model.MetricsSnapshot
	data, err := os.ReadFile(filePath)
	if err == nil {
		json.Unmarshal(data, &snapshots)
	}

	snapshots = append(snapshots, *snap)

	// Write back
	out, err := json.Marshal(snapshots)
	if err != nil {
		log.Error().Err(err).Msg("snapshot: marshal failed")
		return
	}

	if err := os.WriteFile(filePath, out, 0644); err != nil {
		log.Error().Err(err).Msg("snapshot: write failed")
		return
	}

	log.Debug().Str("file", filepath.Base(filePath)).Int("count", len(snapshots)).Msg("snapshot saved")
}

func (s *SnapshotStore) cleanup() {
	cutoff := time.Now().Add(-SnapshotRetention)

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}

	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		// Parse time from filename: 2026-03-03T14.json
		name := e.Name()[:len(e.Name())-5] // strip .json
		t, err := time.Parse("2006-01-02T15", name)
		if err != nil {
			continue
		}
		// File covers the hour starting at t; if the end of that hour is before cutoff, remove
		if t.Add(snapshotsPerFile).Before(cutoff) {
			path := filepath.Join(s.dir, e.Name())
			os.Remove(path)
			log.Debug().Str("file", e.Name()).Msg("snapshot: cleaned up old file")
		}
	}
}

func (s *SnapshotStore) fileForTime(t time.Time) string {
	name := t.Format("2006-01-02T15") + ".json"
	return filepath.Join(s.dir, name)
}

// GetSnapshots returns all snapshots in the given time range.
func (s *SnapshotStore) GetSnapshots(from, to time.Time) []model.MetricsSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []model.MetricsSnapshot

	// Iterate over hours in range
	current := from.Truncate(time.Hour)
	for !current.After(to) {
		filePath := s.fileForTime(current)
		data, err := os.ReadFile(filePath)
		if err == nil {
			var snapshots []model.MetricsSnapshot
			if json.Unmarshal(data, &snapshots) == nil {
				for _, snap := range snapshots {
					if !snap.Timestamp.Before(from) && !snap.Timestamp.After(to) {
						result = append(result, snap)
					}
				}
			}
		}
		current = current.Add(time.Hour)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp.Before(result[j].Timestamp)
	})

	return result
}

// CompareSnapshots returns the difference between two time points.
func (s *SnapshotStore) CompareSnapshots(t1, t2 time.Time) (map[string]interface{}, error) {
	// Find snapshots nearest to t1 and t2
	snap1 := s.findNearest(t1)
	snap2 := s.findNearest(t2)

	if snap1 == nil || snap2 == nil {
		return nil, fmt.Errorf("CompareSnapshots: no snapshot found near requested times")
	}

	result := map[string]interface{}{
		"t1":       snap1.Timestamp,
		"t2":       snap2.Timestamp,
		"snapshot1": snap1,
		"snapshot2": snap2,
	}

	// Compute deltas for key metrics
	delta := map[string]interface{}{}
	if snap1.PG != nil && snap2.PG != nil {
		delta["cache_hit_ratio_change"] = snap2.PG.CacheHitRatio - snap1.PG.CacheHitRatio
		if snap1.PG.Connections != nil && snap2.PG.Connections != nil {
			delta["connections_change"] = snap2.PG.Connections.Total - snap1.PG.Connections.Total
		}
	}
	if snap1.System != nil && snap2.System != nil {
		if snap1.System.CPU != nil && snap2.System.CPU != nil {
			delta["cpu_usage_change"] = snap2.System.CPU.UsagePercent - snap1.System.CPU.UsagePercent
		}
		if snap1.System.Memory != nil && snap2.System.Memory != nil {
			delta["memory_usage_change"] = snap2.System.Memory.UsedPercent - snap1.System.Memory.UsedPercent
		}
	}
	result["delta"] = delta

	return result, nil
}

func (s *SnapshotStore) findNearest(target time.Time) *model.MetricsSnapshot {
	// Search in a 30-minute window around target
	snapshots := s.GetSnapshots(target.Add(-30*time.Minute), target.Add(30*time.Minute))
	if len(snapshots) == 0 {
		return nil
	}

	var nearest *model.MetricsSnapshot
	minDiff := time.Duration(1<<63 - 1)
	for i := range snapshots {
		diff := target.Sub(snapshots[i].Timestamp)
		if diff < 0 {
			diff = -diff
		}
		if diff < minDiff {
			minDiff = diff
			nearest = &snapshots[i]
		}
	}
	return nearest
}

package monitor

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/alert"
	"github.com/avamingli/dbhouse-web/backend/internal/model"
	osmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/os"
	pgmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/pg"
	"github.com/avamingli/dbhouse-web/backend/internal/ws"
	"github.com/rs/zerolog/log"
)

const (
	// CollectInterval is the metric collection interval.
	CollectInterval = 2 * time.Second

	// RingBufferSize is the number of snapshots to keep (10 min at 2s interval).
	RingBufferSize = 300
)

// Aggregator collects PG + OS metrics on a tick, stores them in a ring buffer,
// and broadcasts to connected WebSocket clients.
type Aggregator struct {
	pgCollector  *pgmon.Collector
	osCollector  *osmon.SystemCollector
	delta        *osmon.DeltaCalculator
	hub          *ws.Hub
	alertEngine  *alert.Engine

	mu      sync.RWMutex
	buffer  []model.MetricsSnapshot
	head    int  // next write position in the ring
	count   int  // number of valid entries (up to RingBufferSize)
	running bool

	cancel context.CancelFunc
}

// NewAggregator creates a new metric aggregator.
func NewAggregator(pgCollector *pgmon.Collector, osCollector *osmon.SystemCollector, hub *ws.Hub, alertEngine *alert.Engine) *Aggregator {
	return &Aggregator{
		pgCollector: pgCollector,
		osCollector: osCollector,
		delta:       osmon.NewDeltaCalculator(),
		hub:         hub,
		alertEngine: alertEngine,
		buffer:      make([]model.MetricsSnapshot, RingBufferSize),
	}
}

// Start begins the metric collection loop. Call Stop() to stop it.
func (a *Aggregator) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	a.cancel = cancel

	a.mu.Lock()
	a.running = true
	a.mu.Unlock()

	go a.run(ctx)
}

// Stop halts the collection loop.
func (a *Aggregator) Stop() {
	if a.cancel != nil {
		a.cancel()
	}
	a.mu.Lock()
	a.running = false
	a.mu.Unlock()
}

// IsRunning returns whether the aggregator is actively collecting.
func (a *Aggregator) IsRunning() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.running
}

func (a *Aggregator) run(ctx context.Context) {
	ticker := time.NewTicker(CollectInterval)
	defer ticker.Stop()

	// Collect once immediately on start
	a.collect(ctx)

	for {
		select {
		case <-ctx.Done():
			a.mu.Lock()
			a.running = false
			a.mu.Unlock()
			log.Info().Msg("aggregator stopped")
			return
		case <-ticker.C:
			a.collect(ctx)
		}
	}
}

func (a *Aggregator) collect(ctx context.Context) {
	collectCtx, cancel := context.WithTimeout(ctx, CollectInterval)
	defer cancel()

	snapshot := model.MetricsSnapshot{
		Timestamp: time.Now(),
	}

	// Collect PG metrics
	pgMetrics, err := a.pgCollector.CollectAll(collectCtx)
	if err != nil {
		log.Warn().Err(err).Msg("aggregator: PG metrics collection failed")
	} else {
		snapshot.PG = pgMetrics
	}

	// Collect OS metrics
	osMetrics := a.collectOS(collectCtx)
	snapshot.System = osMetrics

	// Store in ring buffer
	a.mu.Lock()
	a.buffer[a.head] = snapshot
	a.head = (a.head + 1) % RingBufferSize
	if a.count < RingBufferSize {
		a.count++
	}
	a.mu.Unlock()

	// Evaluate alert rules
	if a.alertEngine != nil {
		a.alertEngine.Evaluate(&snapshot)
	}

	// Broadcast via WebSocket
	a.broadcast(snapshot)
}

func (a *Aggregator) collectOS(ctx context.Context) *model.OSMetrics {
	osMetrics := &model.OSMetrics{}

	cpuStats, err := a.osCollector.CPUStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("aggregator: CPU stats failed")
	} else {
		osMetrics.CPU = cpuStats
	}

	memStats, err := a.osCollector.MemoryStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("aggregator: memory stats failed")
	} else {
		osMetrics.Memory = memStats
	}

	disks, err := a.osCollector.DiskStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("aggregator: disk stats failed")
	} else {
		osMetrics.Disks = disks
	}

	diskIO, err := a.osCollector.DiskIOStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("aggregator: disk IO stats failed")
	} else {
		// Compute rates from deltas
		osMetrics.DiskIO = a.delta.ComputeDiskRates(diskIO)
	}

	netStats, err := a.osCollector.NetworkStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("aggregator: network stats failed")
	} else {
		// Compute rates from deltas
		osMetrics.Network = a.delta.ComputeNetworkRates(netStats)
	}

	procs, err := a.osCollector.ProcessStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("aggregator: process stats failed")
	} else {
		osMetrics.Processes = procs
	}

	return osMetrics
}

func (a *Aggregator) broadcast(snapshot model.MetricsSnapshot) {
	data, err := json.Marshal(snapshot)
	if err != nil {
		log.Error().Err(err).Msg("aggregator: failed to marshal snapshot")
		return
	}
	a.hub.Broadcast(data)
}

// GetHistory returns the most recent snapshots within the given duration.
// If duration is 0, returns all buffered snapshots.
func (a *Aggregator) GetHistory(duration time.Duration) []model.MetricsSnapshot {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if a.count == 0 {
		return nil
	}

	cutoff := time.Time{}
	if duration > 0 {
		cutoff = time.Now().Add(-duration)
	}

	// Read from oldest to newest
	result := make([]model.MetricsSnapshot, 0, a.count)
	start := 0
	if a.count == RingBufferSize {
		start = a.head // oldest entry is at head when buffer is full
	}

	for i := 0; i < a.count; i++ {
		idx := (start + i) % RingBufferSize
		snap := a.buffer[idx]
		if !cutoff.IsZero() && snap.Timestamp.Before(cutoff) {
			continue
		}
		result = append(result, snap)
	}

	return result
}

// GetLatest returns the most recent snapshot, or nil if no data has been collected.
func (a *Aggregator) GetLatest() *model.MetricsSnapshot {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if a.count == 0 {
		return nil
	}

	// Latest is at head-1
	idx := (a.head - 1 + RingBufferSize) % RingBufferSize
	snap := a.buffer[idx]
	return &snap
}

// SnapshotCount returns the number of snapshots currently stored.
func (a *Aggregator) SnapshotCount() int {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.count
}

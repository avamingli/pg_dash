package os

import (
	"sync"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
)

// DeltaCalculator stores previous counter snapshots and computes per-second
// rates for disk I/O and network counters.
type DeltaCalculator struct {
	mu sync.Mutex

	prevTime    time.Time
	prevDiskIO  map[string]model.DiskIOStats
	prevNetwork map[string]model.NetworkStats
}

// NewDeltaCalculator creates a new DeltaCalculator.
func NewDeltaCalculator() *DeltaCalculator {
	return &DeltaCalculator{
		prevDiskIO:  make(map[string]model.DiskIOStats),
		prevNetwork: make(map[string]model.NetworkStats),
	}
}

// ComputeDiskRates takes current disk I/O counters, computes per-second rates,
// and stores the current values for the next call.
func (dc *DeltaCalculator) ComputeDiskRates(current []model.DiskIOStats) []model.DiskIOStats {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(dc.prevTime).Seconds()

	result := make([]model.DiskIOStats, len(current))
	copy(result, current)

	if elapsed > 0 && dc.prevTime.After(time.Time{}) {
		for i := range result {
			dev := result[i].Device
			if prev, ok := dc.prevDiskIO[dev]; ok {
				result[i].ReadBPS = float64(safeDelta(result[i].ReadBytes, prev.ReadBytes)) / elapsed
				result[i].WriteBPS = float64(safeDelta(result[i].WriteBytes, prev.WriteBytes)) / elapsed
				result[i].ReadIOPS = float64(safeDelta(result[i].ReadCount, prev.ReadCount)) / elapsed
				result[i].WriteIOPS = float64(safeDelta(result[i].WriteCount, prev.WriteCount)) / elapsed
			}
		}
	}

	// Store current as previous
	dc.prevDiskIO = make(map[string]model.DiskIOStats, len(current))
	for _, d := range current {
		dc.prevDiskIO[d.Device] = d
	}
	dc.prevTime = now

	return result
}

// ComputeNetworkRates takes current network counters, computes per-second rates,
// and stores the current values for the next call.
func (dc *DeltaCalculator) ComputeNetworkRates(current []model.NetworkStats) []model.NetworkStats {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(dc.prevTime).Seconds()

	result := make([]model.NetworkStats, len(current))
	copy(result, current)

	if elapsed > 0 && dc.prevTime.After(time.Time{}) {
		for i := range result {
			iface := result[i].Interface
			if prev, ok := dc.prevNetwork[iface]; ok {
				result[i].SendBPS = float64(safeDelta(result[i].BytesSent, prev.BytesSent)) / elapsed
				result[i].RecvBPS = float64(safeDelta(result[i].BytesRecv, prev.BytesRecv)) / elapsed
			}
		}
	}

	// Store current as previous
	dc.prevNetwork = make(map[string]model.NetworkStats, len(current))
	for _, n := range current {
		dc.prevNetwork[n.Interface] = n
	}
	// Only update prevTime if it wasn't already updated by ComputeDiskRates
	// in the same cycle. Use a small tolerance.
	if now.Sub(dc.prevTime) > 100*time.Millisecond {
		dc.prevTime = now
	}

	return result
}

// safeDelta returns current - previous, handling counter wraps (returns 0 if current < previous).
func safeDelta(current, previous uint64) uint64 {
	if current >= previous {
		return current - previous
	}
	return 0 // counter wrapped or reset
}

package os

import (
	"math"
	"testing"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
)

func TestDeltaCalculator_DiskRates(t *testing.T) {
	dc := NewDeltaCalculator()

	// First call — no previous data, rates should be 0
	snap1 := []model.DiskIOStats{
		{Device: "vda", ReadBytes: 1000, WriteBytes: 2000, ReadCount: 10, WriteCount: 20},
		{Device: "vdb", ReadBytes: 5000, WriteBytes: 8000, ReadCount: 50, WriteCount: 80},
	}
	result1 := dc.ComputeDiskRates(snap1)
	for _, d := range result1 {
		if d.ReadBPS != 0 || d.WriteBPS != 0 {
			t.Errorf("first call should have zero rates, got ReadBPS=%.1f WriteBPS=%.1f", d.ReadBPS, d.WriteBPS)
		}
	}

	// Simulate 2 seconds later
	time.Sleep(100 * time.Millisecond)

	snap2 := []model.DiskIOStats{
		{Device: "vda", ReadBytes: 2000, WriteBytes: 4000, ReadCount: 20, WriteCount: 40},
		{Device: "vdb", ReadBytes: 7000, WriteBytes: 10000, ReadCount: 70, WriteCount: 100},
	}
	result2 := dc.ComputeDiskRates(snap2)

	for _, d := range result2 {
		if d.ReadBPS <= 0 || d.WriteBPS <= 0 {
			t.Errorf("device %s: expected positive rates, got ReadBPS=%.1f WriteBPS=%.1f",
				d.Device, d.ReadBPS, d.WriteBPS)
		}
		if d.ReadIOPS <= 0 || d.WriteIOPS <= 0 {
			t.Errorf("device %s: expected positive IOPS, got ReadIOPS=%.1f WriteIOPS=%.1f",
				d.Device, d.ReadIOPS, d.WriteIOPS)
		}
		t.Logf("Device %s: ReadBPS=%.0f WriteBPS=%.0f ReadIOPS=%.0f WriteIOPS=%.0f",
			d.Device, d.ReadBPS, d.WriteBPS, d.ReadIOPS, d.WriteIOPS)
	}
}

func TestDeltaCalculator_NetworkRates(t *testing.T) {
	dc := NewDeltaCalculator()

	snap1 := []model.NetworkStats{
		{Interface: "eth0", BytesSent: 10000, BytesRecv: 50000},
	}
	result1 := dc.ComputeNetworkRates(snap1)
	if result1[0].SendBPS != 0 || result1[0].RecvBPS != 0 {
		t.Error("first call should have zero rates")
	}

	time.Sleep(100 * time.Millisecond)

	snap2 := []model.NetworkStats{
		{Interface: "eth0", BytesSent: 20000, BytesRecv: 100000},
	}
	result2 := dc.ComputeNetworkRates(snap2)
	if result2[0].SendBPS <= 0 || result2[0].RecvBPS <= 0 {
		t.Errorf("expected positive rates, got SendBPS=%.1f RecvBPS=%.1f",
			result2[0].SendBPS, result2[0].RecvBPS)
	}
	t.Logf("eth0: SendBPS=%.0f RecvBPS=%.0f", result2[0].SendBPS, result2[0].RecvBPS)
}

func TestDeltaCalculator_CounterWrap(t *testing.T) {
	dc := NewDeltaCalculator()

	// Seed first snapshot
	dc.ComputeDiskRates([]model.DiskIOStats{
		{Device: "sda", ReadBytes: 1000, WriteBytes: 2000},
	})

	time.Sleep(50 * time.Millisecond)

	// Counter wrapped: current < previous
	result := dc.ComputeDiskRates([]model.DiskIOStats{
		{Device: "sda", ReadBytes: 500, WriteBytes: 1000},
	})

	// Should produce 0 rates, not negative or huge numbers
	for _, d := range result {
		if d.ReadBPS < 0 || d.WriteBPS < 0 {
			t.Errorf("counter wrap produced negative rate: ReadBPS=%.1f WriteBPS=%.1f",
				d.ReadBPS, d.WriteBPS)
		}
		if math.IsInf(d.ReadBPS, 0) || math.IsNaN(d.ReadBPS) {
			t.Errorf("counter wrap produced Inf/NaN rate: ReadBPS=%v", d.ReadBPS)
		}
	}
}

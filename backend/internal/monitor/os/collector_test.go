package os

import (
	"context"
	"testing"
	"time"
)

func newTestCollector() *SystemCollector {
	return NewSystemCollectorWithPGData("/home/gpadmin/dbhouse/pg17")
}

func TestCPUStats(t *testing.T) {
	sc := newTestCollector()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stats, err := sc.CPUStats(ctx)
	if err != nil {
		t.Fatalf("CPUStats failed: %v", err)
	}

	if stats.NumCPUs == 0 {
		t.Error("expected non-zero NumCPUs")
	}
	t.Logf("CPUs: %d, Usage: %.1f%%, User: %.1f%%, System: %.1f%%, IOWait: %.1f%%",
		stats.NumCPUs, stats.UsagePercent, stats.User, stats.System, stats.IOWait)
	t.Logf("Load: %.2f / %.2f / %.2f", stats.LoadAvg1, stats.LoadAvg5, stats.LoadAvg15)

	if stats.PerCore == nil {
		t.Error("expected non-nil PerCore slice")
	} else {
		t.Logf("Per-core count: %d", len(stats.PerCore))
	}

	// Sanity: user + system + idle + iowait + steal should be ~100
	total := stats.User + stats.System + stats.Idle + stats.IOWait + stats.Steal
	if total < 90 || total > 110 {
		t.Errorf("CPU breakdown sums to %.1f%%, expected ~100%%", total)
	}
}

func TestMemoryStats(t *testing.T) {
	sc := newTestCollector()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stats, err := sc.MemoryStats(ctx)
	if err != nil {
		t.Fatalf("MemoryStats failed: %v", err)
	}

	if stats.Total == 0 {
		t.Error("expected non-zero Total memory")
	}
	if stats.Used == 0 {
		t.Error("expected non-zero Used memory")
	}
	if stats.Available == 0 {
		t.Error("expected non-zero Available memory")
	}

	t.Logf("Total: %d MB, Used: %d MB, Available: %d MB, Cached: %d MB, UsedPct: %.1f%%",
		stats.Total/1024/1024, stats.Used/1024/1024,
		stats.Available/1024/1024, stats.Cached/1024/1024, stats.UsedPercent)
	t.Logf("Swap Total: %d MB, Used: %d MB", stats.SwapTotal/1024/1024, stats.SwapUsed/1024/1024)
}

func TestDiskStats(t *testing.T) {
	sc := newTestCollector()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	disks, err := sc.DiskStats(ctx)
	if err != nil {
		t.Fatalf("DiskStats failed: %v", err)
	}

	if len(disks) == 0 {
		t.Fatal("expected at least one disk partition")
	}

	for _, d := range disks {
		t.Logf("Mount: %-25s Device: %-15s FS: %-8s Total: %d GB  Used: %.1f%%  PGDATA: %v",
			d.MountPoint, d.Device, d.FSType,
			d.Total/1024/1024/1024, d.UsedPercent, d.IsPGData)
	}
}

func TestDiskIOStats(t *testing.T) {
	sc := newTestCollector()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ios, err := sc.DiskIOStats(ctx)
	if err != nil {
		t.Fatalf("DiskIOStats failed: %v", err)
	}

	if len(ios) == 0 {
		t.Fatal("expected at least one disk I/O device")
	}

	for _, io := range ios {
		t.Logf("Device: %-10s Reads: %d  Writes: %d  ReadBytes: %d MB  WriteBytes: %d MB",
			io.Device, io.ReadCount, io.WriteCount,
			io.ReadBytes/1024/1024, io.WriteBytes/1024/1024)
	}
}

func TestNetworkStats(t *testing.T) {
	sc := newTestCollector()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	nets, err := sc.NetworkStats(ctx)
	if err != nil {
		t.Fatalf("NetworkStats failed: %v", err)
	}

	if len(nets) == 0 {
		t.Fatal("expected at least one network interface")
	}

	for _, n := range nets {
		t.Logf("Iface: %-10s Sent: %d MB  Recv: %d MB  ErrIn: %d  ErrOut: %d  DropIn: %d",
			n.Interface, n.BytesSent/1024/1024, n.BytesRecv/1024/1024,
			n.ErrIn, n.ErrOut, n.DropIn)
	}
}

func TestProcessStats(t *testing.T) {
	sc := newTestCollector()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	procs, err := sc.ProcessStats(ctx)
	if err != nil {
		t.Fatalf("ProcessStats failed: %v", err)
	}

	if len(procs) == 0 {
		t.Skip("no PostgreSQL processes found (PG may not be running)")
	}

	t.Logf("Found %d PostgreSQL processes:", len(procs))
	for _, p := range procs {
		t.Logf("  PID: %-7d Type: %-20s CPU: %.1f%%  Mem: %.1f%%  RSS: %d MB  FDs: %d  Threads: %d",
			p.PID, p.Type, p.CPUPercent, p.MemPercent,
			p.MemRSS/1024/1024, p.NumFDs, p.NumThreads)
	}

	// Should have at least a postmaster
	foundPostmaster := false
	for _, p := range procs {
		if p.Type == "postmaster" {
			foundPostmaster = true
			break
		}
	}
	if !foundPostmaster {
		t.Log("Warning: no postmaster process identified (classification may need tuning)")
	}
}

func TestHostInfo(t *testing.T) {
	sc := newTestCollector()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	info, err := sc.HostInfo(ctx)
	if err != nil {
		t.Fatalf("HostInfo failed: %v", err)
	}

	t.Logf("Host: %s, OS: %s, Platform: %s %s, Kernel: %s %s",
		info["hostname"], info["os"], info["platform"],
		info["platform_version"], info["kernel_version"], info["kernel_arch"])
}

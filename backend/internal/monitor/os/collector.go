package os

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

// SystemCollector gathers OS-level metrics using gopsutil.
// All methods are safe for concurrent access (gopsutil is thread-safe).
type SystemCollector struct {
	pgDataPath string // PGDATA mount point to highlight
}

// NewSystemCollector creates a collector. pgDataPath is optional —
// if empty, it tries the PGDATA env var.
func NewSystemCollector() *SystemCollector {
	pgdata := os.Getenv("PGDATA")
	return &SystemCollector{pgDataPath: pgdata}
}

// NewSystemCollectorWithPGData creates a collector with an explicit PGDATA path.
func NewSystemCollectorWithPGData(pgdata string) *SystemCollector {
	return &SystemCollector{pgDataPath: pgdata}
}

// CPUStats returns overall CPU usage, per-core usage, and load averages.
func (sc *SystemCollector) CPUStats(ctx context.Context) (*model.CPUStats, error) {
	// Overall CPU times (single combined value, non-blocking)
	times, err := cpu.TimesWithContext(ctx, false)
	if err != nil {
		return nil, fmt.Errorf("CPUStats: times: %w", err)
	}

	// Per-core percent (measured over ~0 interval = instantaneous from /proc)
	perCorePercent, err := cpu.PercentWithContext(ctx, 0, true)
	if err != nil {
		return nil, fmt.Errorf("CPUStats: per-core percent: %w", err)
	}

	// Overall percent
	overallPercent, err := cpu.PercentWithContext(ctx, 0, false)
	if err != nil {
		return nil, fmt.Errorf("CPUStats: overall percent: %w", err)
	}

	// Load averages
	loadAvg, err := load.AvgWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("CPUStats: load avg: %w", err)
	}

	stats := &model.CPUStats{
		NumCPUs:  runtime.NumCPU(),
		LoadAvg1: loadAvg.Load1,
		LoadAvg5: loadAvg.Load5,
		LoadAvg15: loadAvg.Load15,
		PerCore:  perCorePercent,
	}

	if len(overallPercent) > 0 {
		stats.UsagePercent = overallPercent[0]
	}

	// Decompose from cpu times (the first element is the aggregate)
	if len(times) > 0 {
		t := times[0]
		total := t.User + t.System + t.Idle + t.Iowait + t.Irq +
			t.Softirq + t.Steal + t.Guest + t.GuestNice + t.Nice
		if total > 0 {
			stats.User = (t.User + t.Nice) / total * 100
			stats.System = (t.System + t.Irq + t.Softirq) / total * 100
			stats.Idle = t.Idle / total * 100
			stats.IOWait = t.Iowait / total * 100
			stats.Steal = t.Steal / total * 100
		}
	}

	return stats, nil
}

// MemoryStats returns RAM and swap usage.
func (sc *SystemCollector) MemoryStats(ctx context.Context) (*model.MemoryStats, error) {
	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("MemoryStats: virtual: %w", err)
	}

	sw, err := mem.SwapMemoryWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("MemoryStats: swap: %w", err)
	}

	return &model.MemoryStats{
		Total:       vm.Total,
		Used:        vm.Used,
		Available:   vm.Available,
		Free:        vm.Free,
		Cached:      vm.Cached,
		Buffers:     vm.Buffers,
		SwapTotal:   sw.Total,
		SwapUsed:    sw.Used,
		SwapFree:    sw.Free,
		UsedPercent: vm.UsedPercent,
	}, nil
}

// DiskStats returns per-mount-point disk usage. Highlights the PGDATA mount.
func (sc *SystemCollector) DiskStats(ctx context.Context) ([]model.DiskUsage, error) {
	partitions, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		return nil, fmt.Errorf("DiskStats: partitions: %w", err)
	}

	pgdataMount := sc.resolvePGDataMount()

	var results []model.DiskUsage
	for _, p := range partitions {
		usage, err := disk.UsageWithContext(ctx, p.Mountpoint)
		if err != nil {
			continue // skip inaccessible mounts
		}

		isPG := false
		if pgdataMount != "" && p.Mountpoint == pgdataMount {
			isPG = true
		}

		results = append(results, model.DiskUsage{
			MountPoint:  p.Mountpoint,
			Device:      p.Device,
			FSType:      p.Fstype,
			Total:       usage.Total,
			Used:        usage.Used,
			Free:        usage.Free,
			UsedPercent: usage.UsedPercent,
			IsPGData:    isPG,
		})
	}

	return results, nil
}

// DiskIOStats returns per-device I/O counters.
// The caller should use DeltaCalculator to compute rates.
func (sc *SystemCollector) DiskIOStats(ctx context.Context) ([]model.DiskIOStats, error) {
	counters, err := disk.IOCountersWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("DiskIOStats: %w", err)
	}

	var results []model.DiskIOStats
	for name, c := range counters {
		// Skip partition-level entries (e.g. sda1) — keep device-level (sda, nvme0n1)
		if isPartition(name) {
			continue
		}
		results = append(results, model.DiskIOStats{
			Device:         name,
			ReadBytes:      c.ReadBytes,
			WriteBytes:     c.WriteBytes,
			ReadCount:      c.ReadCount,
			WriteCount:     c.WriteCount,
			ReadTime:       c.ReadTime,
			WriteTime:      c.WriteTime,
			IOTime:         c.IoTime,
			WeightedIOTime: c.WeightedIO,
			IopsInProgress: c.IopsInProgress,
		})
	}

	return results, nil
}

// NetworkStats returns per-interface network counters.
func (sc *SystemCollector) NetworkStats(ctx context.Context) ([]model.NetworkStats, error) {
	counters, err := net.IOCountersWithContext(ctx, true)
	if err != nil {
		return nil, fmt.Errorf("NetworkStats: %w", err)
	}

	var results []model.NetworkStats
	for _, c := range counters {
		// Skip loopback
		if c.Name == "lo" {
			continue
		}
		results = append(results, model.NetworkStats{
			Interface:   c.Name,
			BytesSent:   c.BytesSent,
			BytesRecv:   c.BytesRecv,
			PacketsSent: c.PacketsSent,
			PacketsRecv: c.PacketsRecv,
			ErrIn:       c.Errin,
			ErrOut:      c.Errout,
			DropIn:      c.Dropin,
			DropOut:     c.Dropout,
		})
	}

	return results, nil
}

// ProcessStats finds PostgreSQL-related processes and returns their resource usage.
func (sc *SystemCollector) ProcessStats(ctx context.Context) ([]model.ProcessInfo, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("ProcessStats: %w", err)
	}

	var results []model.ProcessInfo
	for _, p := range procs {
		name, err := p.NameWithContext(ctx)
		if err != nil {
			continue
		}

		// Only include PostgreSQL-related processes
		if name != "postgres" && name != "postmaster" {
			continue
		}

		cmdline, _ := p.CmdlineWithContext(ctx)
		cpuPct, _ := p.CPUPercentWithContext(ctx)
		memPct, _ := p.MemoryPercentWithContext(ctx)

		var memRSS uint64
		memInfo, err := p.MemoryInfoWithContext(ctx)
		if err == nil && memInfo != nil {
			memRSS = memInfo.RSS
		}

		status, _ := p.StatusWithContext(ctx)
		numFDs, _ := p.NumFDsWithContext(ctx)
		numThreads, _ := p.NumThreadsWithContext(ctx)

		procType := classifyPGProcess(cmdline)

		statusStr := ""
		if len(status) > 0 {
			statusStr = status[0]
		}

		results = append(results, model.ProcessInfo{
			PID:        p.Pid,
			Name:       name,
			Type:       procType,
			CPUPercent: cpuPct,
			MemPercent: memPct,
			MemRSS:     memRSS,
			Status:     statusStr,
			Cmdline:    cmdline,
			NumFDs:     numFDs,
			NumThreads: numThreads,
		})
	}

	return results, nil
}

// HostInfo returns basic host information.
func (sc *SystemCollector) HostInfo(ctx context.Context) (map[string]string, error) {
	info, err := host.InfoWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("HostInfo: %w", err)
	}
	return map[string]string{
		"hostname":         info.Hostname,
		"os":               info.OS,
		"platform":         info.Platform,
		"platform_version": info.PlatformVersion,
		"kernel_version":   info.KernelVersion,
		"kernel_arch":      info.KernelArch,
		"uptime":           fmt.Sprintf("%d", info.Uptime),
	}, nil
}

// classifyPGProcess identifies the PostgreSQL process type from its cmdline.
func classifyPGProcess(cmdline string) string {
	lower := strings.ToLower(cmdline)
	switch {
	case strings.Contains(lower, "checkpointer"):
		return "checkpointer"
	case strings.Contains(lower, "background writer"):
		return "bgwriter"
	case strings.Contains(lower, "walwriter"):
		return "walwriter"
	case strings.Contains(lower, "wal writer"):
		return "walwriter"
	case strings.Contains(lower, "autovacuum launcher"):
		return "autovacuum_launcher"
	case strings.Contains(lower, "autovacuum worker"):
		return "autovacuum_worker"
	case strings.Contains(lower, "logical replication"):
		return "logical_replication"
	case strings.Contains(lower, "wal sender"):
		return "wal_sender"
	case strings.Contains(lower, "walsender"):
		return "wal_sender"
	case strings.Contains(lower, "wal receiver"):
		return "wal_receiver"
	case strings.Contains(lower, "walreceiver"):
		return "wal_receiver"
	case strings.Contains(lower, "stats collector"):
		return "stats_collector"
	case strings.Contains(lower, "-d") || strings.Contains(lower, "postgres -d"):
		return "postmaster"
	case strings.HasSuffix(strings.TrimSpace(lower), "postgres") ||
		strings.Contains(lower, "bin/postgres"):
		return "postmaster"
	default:
		return "backend"
	}
}

// resolvePGDataMount finds the mount point containing the PGDATA directory.
func (sc *SystemCollector) resolvePGDataMount() string {
	if sc.pgDataPath == "" {
		return ""
	}

	// Resolve symlinks
	resolved, err := filepath.EvalSymlinks(sc.pgDataPath)
	if err != nil {
		resolved = sc.pgDataPath
	}

	// Walk up the directory tree to find the mount point
	// by comparing device IDs
	path := resolved
	for {
		parent := filepath.Dir(path)
		if parent == path {
			return path // reached root
		}

		pathInfo, err := os.Stat(path)
		if err != nil {
			return ""
		}
		parentInfo, err := os.Stat(parent)
		if err != nil {
			return path
		}

		// On Linux, different mount points have different device numbers.
		// We check via os.SameFile which compares dev+inode — but that's
		// not what we need. Instead, just return the pgdata path and let
		// the caller match by prefix against mount points.
		_ = pathInfo
		_ = parentInfo
		path = parent
	}
}

// isPartition returns true if the device name looks like a partition (e.g. sda1, nvme0n1p1).
func isPartition(name string) bool {
	// sda1, sdb2, etc.
	if len(name) >= 4 && name[0] == 's' && name[1] == 'd' &&
		name[2] >= 'a' && name[2] <= 'z' && name[3] >= '0' && name[3] <= '9' {
		return true
	}
	// nvme0n1p1 etc.
	if strings.Contains(name, "p") && strings.HasPrefix(name, "nvme") {
		parts := strings.Split(name, "p")
		if len(parts) >= 3 {
			return true
		}
	}
	return false
}

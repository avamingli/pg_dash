package model

import "time"

// MetricsSnapshot is the top-level struct broadcast via WebSocket every 2s.
type MetricsSnapshot struct {
	Timestamp time.Time  `json:"timestamp"`
	PG        *PGMetrics `json:"pg,omitempty"`
	System    *OSMetrics `json:"system,omitempty"`
}

// PGMetrics holds all PostgreSQL-level metrics.
type PGMetrics struct {
	Connections   *ConnectionSummary `json:"connections,omitempty"`
	TPS           *TPSStats          `json:"tps,omitempty"`
	CacheHitRatio float64            `json:"cache_hit_ratio"`
	DatabaseSizes []DatabaseSize     `json:"database_sizes,omitempty"`
	LogStats      *LogStats          `json:"log_stats,omitempty"`
}

// LogStats holds PostgreSQL log severity counts.
type LogStats struct {
	Available    bool             `json:"available"`
	Message      string           `json:"message,omitempty"`
	FatalCount   int64            `json:"fatal_count"`
	ErrorCount   int64            `json:"error_count"`
	WarningCount int64            `json:"warning_count"`
	PanicCount   int64            `json:"panic_count"`
	HourlyCounts []HourlyLogCount `json:"hourly_counts,omitempty"`
	LogFile      string           `json:"log_file,omitempty"`
}

// HourlyLogCount holds severity counts for a single hour.
type HourlyLogCount struct {
	Hour    string `json:"hour"`
	Fatal   int64  `json:"fatal"`
	Error   int64  `json:"error"`
	Warning int64  `json:"warning"`
	Panic   int64  `json:"panic"`
}

// OSMetrics holds all OS-level metrics from gopsutil.
type OSMetrics struct {
	CPU       *CPUStats      `json:"cpu,omitempty"`
	Memory    *MemoryStats   `json:"memory,omitempty"`
	Disks     []DiskUsage    `json:"disks,omitempty"`
	DiskIO    []DiskIOStats  `json:"disk_io,omitempty"`
	Network   []NetworkStats `json:"network,omitempty"`
	Processes []ProcessInfo  `json:"processes,omitempty"`
}

type ConnectionSummary struct {
	Total             int `json:"total"`
	Active            int `json:"active"`
	Idle              int `json:"idle"`
	IdleInTransaction int `json:"idle_in_transaction"`
	Waiting           int `json:"waiting"`
	MaxConnections    int `json:"max_connections"`
}

type TPSStats struct {
	Commits   int64 `json:"commits"`
	Rollbacks int64 `json:"rollbacks"`
}

type DatabaseSize struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// CPUStats holds overall and per-core CPU usage, plus load averages.
type CPUStats struct {
	UsagePercent float64   `json:"usage_percent"`
	User         float64   `json:"user"`
	System       float64   `json:"system"`
	Idle         float64   `json:"idle"`
	IOWait       float64   `json:"iowait"`
	Steal        float64   `json:"steal"`
	LoadAvg1     float64   `json:"load_avg_1"`
	LoadAvg5     float64   `json:"load_avg_5"`
	LoadAvg15    float64   `json:"load_avg_15"`
	NumCPUs      int       `json:"num_cpus"`
	PerCore      []float64 `json:"per_core,omitempty"`
}

// MemoryStats holds RAM and swap usage.
type MemoryStats struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	Free        uint64  `json:"free"`
	Cached      uint64  `json:"cached"`
	Buffers     uint64  `json:"buffers"`
	SwapTotal   uint64  `json:"swap_total"`
	SwapUsed    uint64  `json:"swap_used"`
	SwapFree    uint64  `json:"swap_free"`
	UsedPercent float64 `json:"used_percent"`
}

// DiskUsage holds per-mount-point disk space usage.
type DiskUsage struct {
	MountPoint  string  `json:"mount_point"`
	Device      string  `json:"device"`
	FSType      string  `json:"fstype"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"used_percent"`
	IsPGData    bool    `json:"is_pgdata"`
}

// DiskIOStats holds per-device I/O counters and computed rates.
type DiskIOStats struct {
	Device          string  `json:"device"`
	ReadBytes       uint64  `json:"read_bytes"`
	WriteBytes      uint64  `json:"write_bytes"`
	ReadCount       uint64  `json:"read_count"`
	WriteCount      uint64  `json:"write_count"`
	ReadTime        uint64  `json:"read_time"`
	WriteTime       uint64  `json:"write_time"`
	IOTime          uint64  `json:"io_time"`
	WeightedIOTime  uint64  `json:"weighted_io_time"`
	IopsInProgress  uint64  `json:"iops_in_progress"`
	ReadBPS         float64 `json:"read_bps"`
	WriteBPS        float64 `json:"write_bps"`
	ReadIOPS        float64 `json:"read_iops"`
	WriteIOPS       float64 `json:"write_iops"`
}

// NetworkStats holds per-interface network counters and computed rates.
type NetworkStats struct {
	Interface   string  `json:"interface"`
	BytesSent   uint64  `json:"bytes_sent"`
	BytesRecv   uint64  `json:"bytes_recv"`
	PacketsSent uint64  `json:"packets_sent"`
	PacketsRecv uint64  `json:"packets_recv"`
	ErrIn       uint64  `json:"errin"`
	ErrOut      uint64  `json:"errout"`
	DropIn      uint64  `json:"dropin"`
	DropOut     uint64  `json:"dropout"`
	SendBPS     float64 `json:"send_bps"`
	RecvBPS     float64 `json:"recv_bps"`
}

// ProcessInfo holds info about a single PostgreSQL-related process.
type ProcessInfo struct {
	PID        int32   `json:"pid"`
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	CPUPercent float64 `json:"cpu_percent"`
	MemPercent float32 `json:"mem_percent"`
	MemRSS     uint64  `json:"mem_rss"`
	Status     string  `json:"status"`
	Cmdline    string  `json:"cmdline"`
	NumFDs     int32   `json:"num_fds"`
	NumThreads int32   `json:"num_threads"`
}

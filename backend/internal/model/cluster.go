package model

// SegmentInfo represents a row from gp_segment_configuration.
type SegmentInfo struct {
	Dbid          int    `json:"dbid"`
	ContentID     int    `json:"content_id"`
	Role          string `json:"role"`           // "primary" | "mirror"
	PreferredRole string `json:"preferred_role"`
	Mode          string `json:"mode"`           // "synchronized" | "not_synced"
	Status        string `json:"status"`         // "up" | "down"
	Hostname      string `json:"hostname"`
	Port          int    `json:"port"`
	DataDir       string `json:"datadir"`
	IsCoordinator bool   `json:"is_coordinator"`
	IsBalanced    bool   `json:"is_balanced"`
}

// ClusterHealth is a summary of segment health counts.
type ClusterHealth struct {
	PrimariesUp     int `json:"primaries_up"`
	PrimariesDown   int `json:"primaries_down"`
	MirrorsUp       int `json:"mirrors_up"`
	MirrorsDown     int `json:"mirrors_down"`
	Unbalanced      int `json:"unbalanced"`
	NotSynchronized int `json:"not_synchronized"`
}

// SegmentReplication holds WAL replication status for one segment pair.
type SegmentReplication struct {
	SegmentID int    `json:"gp_segment_id"`
	State     string `json:"state"`
	SyncState string `json:"sync_state"`
	SyncError string `json:"sync_error"`
	WriteLag  string `json:"write_lag"`
	FlushLag  string `json:"flush_lag"`
	ReplayLag string `json:"replay_lag"`
}

// ConfigHistoryEntry is a row from gp_configuration_history.
type ConfigHistoryEntry struct {
	Time        string `json:"time"`
	Dbid        int    `json:"dbid"`
	Description string `json:"description"`
}

// ResourceQueueStatus holds queue limits vs current usage.
type ResourceQueueStatus struct {
	Name        string `json:"name"`
	CountLimit  string `json:"count_limit"`
	CountValue  string `json:"count_value"`
	CostLimit   string `json:"cost_limit"`
	CostValue   string `json:"cost_value"`
	MemoryLimit string `json:"memory_limit"`
	MemoryValue string `json:"memory_value"`
	Waiters     int    `json:"waiters"`
	Holders     int    `json:"holders"`
}

// ResourceGroupStatus holds resource group runtime status.
type ResourceGroupStatus struct {
	GroupName          string `json:"group_name"`
	NumRunning         int    `json:"num_running"`
	NumQueueing        int    `json:"num_queueing"`
	NumQueued          int    `json:"num_queued"`
	NumExecuted        int    `json:"num_executed"`
	TotalQueueDuration string `json:"total_queue_duration"`
}

// ResourceGroupConfig holds resource group configuration.
type ResourceGroupConfig struct {
	GroupName     string `json:"group_name"`
	Concurrency   string `json:"concurrency"`
	CpuMaxPercent string `json:"cpu_max_percent"`
	CpuWeight     string `json:"cpu_weight"`
	MemoryQuota   string `json:"memory_quota"`
	MinCost       string `json:"min_cost"`
	IoLimit       string `json:"io_limit"`
}

// PerSegmentStats holds per-segment database-level stats.
type PerSegmentStats struct {
	SegmentID    int   `json:"gp_segment_id"`
	XactCommit   int64 `json:"xact_commit"`
	XactRollback int64 `json:"xact_rollback"`
	BlksRead     int64 `json:"blks_read"`
	BlksHit      int64 `json:"blks_hit"`
	TempFiles    int64 `json:"temp_files"`
	TempBytes    int64 `json:"temp_bytes"`
}

// WorkfileUsage holds spill/workfile usage per segment.
type WorkfileUsage struct {
	SegmentID int   `json:"gp_segment_id"`
	Size      int64 `json:"size"`
	NumFiles  int   `json:"num_files"`
}

// DataSkew holds table-level data distribution skew info.
type DataSkew struct {
	Schema      string  `json:"schema"`
	TableName   string  `json:"table_name"`
	Coefficient float64 `json:"coefficient"`
}

// DiskFree holds per-segment-host disk free space.
type DiskFree struct {
	SegmentID int    `json:"gp_segment_id"`
	Hostname  string `json:"hostname"`
	Device    string `json:"device"`
	Space     int64  `json:"space"`
}

// ClusterMetrics holds distributed cluster-specific metrics collected on each tick.
type ClusterMetrics struct {
	ClusterHealth      *ClusterHealth       `json:"cluster_health,omitempty"`
	SegmentReplication []SegmentReplication  `json:"segment_replication,omitempty"`
}

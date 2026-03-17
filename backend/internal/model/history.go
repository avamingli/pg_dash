package model

import "time"

// QueryHistoryEntry represents a single row from dbhouse_query_history.
type QueryHistoryEntry struct {
	ID              int64      `json:"id"`
	QueryID         int64      `json:"queryid"`
	Database        string     `json:"database"`
	Username        string     `json:"username"`
	QueryText       string     `json:"query_text"`
	Status          string     `json:"status"`
	SubmittedAt     time.Time  `json:"submitted_at"`
	EndedAt         *time.Time `json:"ended_at,omitempty"`
	DurationMs      float64    `json:"duration_ms"`
	RowsAffected    int64      `json:"rows_affected"`
	SharedBlksHit   int64      `json:"shared_blks_hit"`
	SharedBlksRead  int64      `json:"shared_blks_read"`
	TempBlksWritten int64      `json:"temp_blks_written"`
	WALBytes        int64      `json:"wal_bytes"`
	Calls           int64      `json:"calls"`
	MeanExecTime    float64    `json:"mean_exec_time"`
}

// QueryHistoryResponse wraps search results with pagination info.
type QueryHistoryResponse struct {
	Entries []QueryHistoryEntry `json:"entries"`
	Total   int64               `json:"total"`
	Limit   int                 `json:"limit"`
	Offset  int                 `json:"offset"`
}

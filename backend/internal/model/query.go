package model

type StatStatement struct {
	QueryID        int64   `json:"queryid"`
	Query          string  `json:"query"`
	Calls          int64   `json:"calls"`
	TotalExecTime  float64 `json:"total_exec_time"`
	MeanExecTime   float64 `json:"mean_exec_time"`
	MinExecTime    float64 `json:"min_exec_time"`
	MaxExecTime    float64 `json:"max_exec_time"`
	StddevExecTime float64 `json:"stddev_exec_time"`
	Rows           int64   `json:"rows"`
	SharedBlksHit  int64   `json:"shared_blks_hit"`
	SharedBlksRead int64   `json:"shared_blks_read"`
	TempBlksRead   int64   `json:"temp_blks_read"`
	TempBlksWritten int64  `json:"temp_blks_written"`
	BlkReadTime    float64 `json:"blk_read_time"`
	BlkWriteTime   float64 `json:"blk_write_time"`
}

type QueryResult struct {
	Columns []string        `json:"columns"`
	Rows    [][]interface{} `json:"rows"`
	RowCount int            `json:"row_count"`
	ExecTime float64        `json:"exec_time_ms"`
}

type ExplainResult struct {
	Plan     interface{} `json:"plan"`
	ExecTime float64     `json:"exec_time_ms"`
}

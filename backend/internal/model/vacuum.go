package model

type VacuumProgress struct {
	PID              int    `json:"pid"`
	Database         string `json:"datname"`
	SchemaName       string `json:"schemaname"`
	TableName        string `json:"relname"`
	Phase            string `json:"phase"`
	HeapBlksTotal    int64  `json:"heap_blks_total"`
	HeapBlksScanned  int64  `json:"heap_blks_scanned"`
	HeapBlksVacuumed int64  `json:"heap_blks_vacuumed"`
}

type VacuumNeeded struct {
	SchemaName     string  `json:"schemaname"`
	TableName      string  `json:"relname"`
	DeadTuples     int64   `json:"n_dead_tup"`
	LiveTuples     int64   `json:"n_live_tup"`
	DeadTupleRatio float64 `json:"dead_tuple_ratio"`
	LastVacuum     string  `json:"last_vacuum"`
	LastAutoVacuum string  `json:"last_autovacuum"`
}

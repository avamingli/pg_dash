package model

import "time"

type Database struct {
	Name          string     `json:"name"`
	Size          int64      `json:"size"`
	SizeHuman     string     `json:"size_human"`
	NumBackends   int        `json:"numbackends"`
	XactCommit    int64      `json:"xact_commit"`
	XactRollback  int64      `json:"xact_rollback"`
	BlksRead      int64      `json:"blks_read"`
	BlksHit       int64      `json:"blks_hit"`
	TupReturned   int64      `json:"tup_returned"`
	TupFetched    int64      `json:"tup_fetched"`
	TupInserted   int64      `json:"tup_inserted"`
	TupUpdated    int64      `json:"tup_updated"`
	TupDeleted    int64      `json:"tup_deleted"`
	Conflicts     int64      `json:"conflicts"`
	TempFiles     int64      `json:"temp_files"`
	TempBytes     int64      `json:"temp_bytes"`
	Deadlocks     int64      `json:"deadlocks"`
	CacheHitRatio float64    `json:"cache_hit_ratio"`
	StatsReset    *time.Time `json:"stats_reset"`
}

type Table struct {
	SchemaName        string     `json:"schemaname"`
	TableName         string     `json:"relname"`
	TotalSize         int64      `json:"total_size"`
	TableSize         int64      `json:"table_size"`
	IndexSize         int64      `json:"index_size"`
	LiveTuples        int64      `json:"n_live_tup"`
	DeadTuples        int64      `json:"n_dead_tup"`
	DeadTupleRatio    float64    `json:"dead_tuple_ratio"`
	SeqScan           int64      `json:"seq_scan"`
	SeqTupRead        int64      `json:"seq_tup_read"`
	IdxScan           int64      `json:"idx_scan"`
	IdxTupFetch       int64      `json:"idx_tup_fetch"`
	InsertCount       int64      `json:"n_tup_ins"`
	UpdateCount       int64      `json:"n_tup_upd"`
	DeleteCount       int64      `json:"n_tup_del"`
	HotUpdateCount    int64      `json:"n_tup_hot_upd"`
	LastVacuum        *time.Time `json:"last_vacuum"`
	LastAutoVacuum    *time.Time `json:"last_autovacuum"`
	LastAnalyze       *time.Time `json:"last_analyze"`
	LastAutoAnalyze   *time.Time `json:"last_autoanalyze"`
	VacuumCount       int64      `json:"vacuum_count"`
	AutoVacuumCount   int64      `json:"autovacuum_count"`
	AnalyzeCount      int64      `json:"analyze_count"`
	AutoAnalyzeCount  int64      `json:"autoanalyze_count"`
}

type Index struct {
	SchemaName   string `json:"schemaname"`
	TableName    string `json:"relname"`
	IndexName    string `json:"indexrelname"`
	Size         int64  `json:"size"`
	IdxScan      int64  `json:"idx_scan"`
	IdxTupRead   int64  `json:"idx_tup_read"`
	IdxTupFetch  int64  `json:"idx_tup_fetch"`
}

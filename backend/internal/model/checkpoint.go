package model

type CheckpointStats struct {
	CheckpointsTimed    int64   `json:"checkpoints_timed"`
	CheckpointsReq      int64   `json:"checkpoints_req"`
	CheckpointWriteTime float64 `json:"checkpoint_write_time"`
	CheckpointSyncTime  float64 `json:"checkpoint_sync_time"`
	BuffersCheckpoint   int64   `json:"buffers_checkpoint"`
	BuffersClean        int64   `json:"buffers_clean"`
	MaxWrittenClean     int64   `json:"maxwritten_clean"`
	BuffersBackend      int64   `json:"buffers_backend"`
	BuffersBackendFsync int64   `json:"buffers_backend_fsync"`
	BuffersAlloc        int64   `json:"buffers_alloc"`
}

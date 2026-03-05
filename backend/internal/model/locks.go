package model

type Lock struct {
	LockType  string `json:"locktype"`
	Database  string `json:"database"`
	Relation  string `json:"relation"`
	Mode      string `json:"mode"`
	Granted   bool   `json:"granted"`
	PID       int    `json:"pid"`
	Query     string `json:"query"`
}

type LockConflict struct {
	BlockingPID   int    `json:"blocking_pid"`
	BlockedPID    int    `json:"blocked_pid"`
	BlockingQuery string `json:"blocking_query"`
	BlockedQuery  string `json:"blocked_query"`
}

package model

import "time"

type Connection struct {
	PID           int        `json:"pid"`
	UserName      string     `json:"usename"`
	Database      string     `json:"datname"`
	ClientAddr    string     `json:"client_addr"`
	ClientPort    int        `json:"client_port"`
	BackendStart  *time.Time `json:"backend_start"`
	XactStart     *time.Time `json:"xact_start"`
	QueryStart    *time.Time `json:"query_start"`
	StateChange   *time.Time `json:"state_change"`
	WaitEventType string     `json:"wait_event_type"`
	WaitEvent     string     `json:"wait_event"`
	State         string     `json:"state"`
	BackendType   string     `json:"backend_type"`
	Query         string     `json:"query"`
}

type ConnectionCount struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

package model

import "time"

type ServerInfo struct {
	Version  string            `json:"version"`
	Uptime   string            `json:"uptime"`
	StartTime time.Time        `json:"start_time"`
	Settings map[string]string `json:"settings"`
}

type PGSetting struct {
	Name           string `json:"name"`
	Setting        string `json:"setting"`
	Unit           string `json:"unit"`
	Category       string `json:"category"`
	ShortDesc      string `json:"short_desc"`
	Source         string `json:"source"`
	BootVal        string `json:"boot_val"`
	ResetVal       string `json:"reset_val"`
	PendingRestart bool   `json:"pending_restart"`
}

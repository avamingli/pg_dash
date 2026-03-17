package model

import "time"

// Recommendation is a single finding from the health scanner.
type Recommendation struct {
	Category   string `json:"category"`
	Severity   string `json:"severity"`
	Schema     string `json:"schema"`
	Table      string `json:"table"`
	Database   string `json:"database,omitempty"`
	CurrentVal string `json:"current_value"`
	Threshold  string `json:"threshold"`
	Message    string `json:"message"`
	Action     string `json:"action"`
	ActionSQL  string `json:"action_sql"`
	SizeBytes  int64  `json:"size_bytes"`
}

// ScanResult holds the output of a recommendation scan.
type ScanResult struct {
	ScannedAt       time.Time        `json:"scanned_at"`
	DurationMs      int64            `json:"duration_ms"`
	Recommendations []Recommendation `json:"recommendations"`
	Summary         ScanSummary      `json:"summary"`
}

// ScanSummary counts recommendations by severity and category.
type ScanSummary struct {
	Total      int            `json:"total"`
	Critical   int            `json:"critical"`
	Warning    int            `json:"warning"`
	Info       int            `json:"info"`
	ByCategory map[string]int `json:"by_category"`
}

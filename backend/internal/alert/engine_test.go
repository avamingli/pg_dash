package alert

import (
	"testing"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
)

func TestNewEngine(t *testing.T) {
	e := NewEngine(nil)
	if e == nil {
		t.Fatal("NewEngine returned nil")
	}
	if len(e.rules) == 0 {
		t.Fatal("engine should have default rules")
	}
	if len(e.alerts) != 0 {
		t.Fatal("engine should start with no alerts")
	}
}

func TestEvaluate_ConnectionsWarning(t *testing.T) {
	var broadcasted []byte
	e := NewEngine(func(data []byte) { broadcasted = data })

	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{
				Total:          85,
				MaxConnections: 100,
			},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}

	e.Evaluate(snap)

	alerts := e.GetAlerts()
	if len(alerts) == 0 {
		t.Fatal("expected alert for connections > 80%")
	}

	found := false
	for _, a := range alerts {
		if a.RuleName == "connections_warning" {
			found = true
			if a.Severity != SeverityWarning {
				t.Errorf("expected warning severity, got %s", a.Severity)
			}
			if a.Resolved {
				t.Error("alert should not be resolved")
			}
		}
	}
	if !found {
		t.Error("connections_warning alert not found")
	}
	if broadcasted == nil {
		t.Error("expected broadcast to be called")
	}
}

func TestEvaluate_ConnectionsCritical(t *testing.T) {
	e := NewEngine(nil)

	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{
				Total:          96,
				MaxConnections: 100,
			},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}

	e.Evaluate(snap)

	for _, a := range e.GetAlerts() {
		if a.RuleName == "connections_warning" && a.Severity != SeverityCritical {
			t.Errorf("expected critical for 96%% connections, got %s", a.Severity)
		}
	}
}

func TestEvaluate_AutoResolve(t *testing.T) {
	e := NewEngine(nil)

	// Fire alert
	highSnap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 85, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}
	e.Evaluate(highSnap)
	if e.ActiveCount() == 0 {
		t.Fatal("expected active alerts")
	}

	// Resolve by going below threshold
	normalSnap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 50, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}
	e.Evaluate(normalSnap)

	// Connections alert should be resolved
	for _, a := range e.GetAlerts() {
		if a.RuleName == "connections_warning" && !a.Resolved {
			t.Error("connections_warning alert should be resolved")
		}
	}
}

func TestEvaluate_Cooldown(t *testing.T) {
	e := NewEngine(nil)
	// Set short cooldown for test
	for i := range e.rules {
		e.rules[i].Cooldown = 100 * time.Millisecond
	}

	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 85, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}

	// First evaluation fires
	e.Evaluate(snap)
	count1 := len(e.GetAlerts())

	// Resolve first alert
	normalSnap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 50, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}
	e.Evaluate(normalSnap)

	// Immediately re-fire (within cooldown) — should NOT create new alert
	e.Evaluate(snap)
	count2 := len(e.GetAlerts())
	if count2 > count1 {
		t.Errorf("expected cooldown to prevent new alert, got %d vs %d", count2, count1)
	}

	// Wait for cooldown to expire
	time.Sleep(150 * time.Millisecond)
	e.Evaluate(normalSnap) // resolve first
	e.Evaluate(snap)       // should fire again
	count3 := len(e.GetAlerts())
	if count3 <= count1 {
		t.Error("expected new alert after cooldown expired")
	}
}

func TestEvaluate_CPUWarning(t *testing.T) {
	e := NewEngine(nil)
	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 10, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 85},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}

	e.Evaluate(snap)

	found := false
	for _, a := range e.GetAlerts() {
		if a.RuleName == "cpu_usage_warning" {
			found = true
			if a.Severity != SeverityWarning {
				t.Errorf("expected warning, got %s", a.Severity)
			}
		}
	}
	if !found {
		t.Error("cpu_usage_warning alert not found")
	}
}

func TestEvaluate_DiskWarning(t *testing.T) {
	e := NewEngine(nil)
	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 10, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
			Disks: []model.DiskUsage{
				{MountPoint: "/data", UsedPercent: 85},
			},
		},
	}

	e.Evaluate(snap)

	found := false
	for _, a := range e.GetAlerts() {
		if a.RuleName == "disk_usage_warning" {
			found = true
		}
	}
	if !found {
		t.Error("disk_usage_warning alert not found")
	}
}

func TestEvaluate_NoAlertOnNilSnapshot(t *testing.T) {
	e := NewEngine(nil)
	snap := &model.MetricsSnapshot{Timestamp: time.Now()}
	e.Evaluate(snap)

	if len(e.GetAlerts()) != 0 {
		t.Error("expected no alerts for nil PG/System metrics")
	}
}

func TestGetAlerts_NewestFirst(t *testing.T) {
	e := NewEngine(nil)
	for i := range e.rules {
		e.rules[i].Cooldown = 0
	}

	// Fire two different rules
	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 85, MaxConnections: 100},
			CacheHitRatio: 90,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}
	e.Evaluate(snap)

	alerts := e.GetAlerts()
	if len(alerts) < 2 {
		t.Fatalf("expected at least 2 alerts, got %d", len(alerts))
	}
	// Verify newest first (higher ID = newer)
	if alerts[0].ID < alerts[1].ID {
		t.Error("expected alerts in newest-first order")
	}
}

func TestGetActiveAlerts(t *testing.T) {
	e := NewEngine(nil)

	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 85, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}
	e.Evaluate(snap)

	active := e.GetActiveAlerts()
	total := e.GetAlerts()
	if len(active) == 0 {
		t.Fatal("expected active alerts")
	}
	if len(active) > len(total) {
		t.Error("active alerts should not exceed total alerts")
	}

	for _, a := range active {
		if a.Resolved {
			t.Errorf("active alert %s should not be resolved", a.ID)
		}
	}
}

func TestActiveCount(t *testing.T) {
	e := NewEngine(nil)

	if e.ActiveCount() != 0 {
		t.Error("expected 0 active alerts initially")
	}

	snap := &model.MetricsSnapshot{
		Timestamp: time.Now(),
		PG: &model.PGMetrics{
			Connections: &model.ConnectionSummary{Total: 85, MaxConnections: 100},
			CacheHitRatio: 99.9,
		},
		System: &model.OSMetrics{
			CPU:    &model.CPUStats{UsagePercent: 30},
			Memory: &model.MemoryStats{UsedPercent: 50},
		},
	}
	e.Evaluate(snap)

	if e.ActiveCount() == 0 {
		t.Error("expected non-zero active count after alert")
	}
}

func TestMaxAlerts(t *testing.T) {
	e := NewEngine(nil)
	// Fill up alerts manually
	e.mu.Lock()
	for i := 0; i < maxAlerts+10; i++ {
		e.addAlertLocked(Alert{
			ID:       "test",
			RuleName: "test",
			Severity: SeverityInfo,
		})
	}
	e.mu.Unlock()

	if len(e.GetAlerts()) > maxAlerts {
		t.Errorf("expected max %d alerts, got %d", maxAlerts, len(e.GetAlerts()))
	}
}

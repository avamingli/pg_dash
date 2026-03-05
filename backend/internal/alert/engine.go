package alert

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/rs/zerolog/log"
)

// Severity levels for alerts.
type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarning  Severity = "warning"
	SeverityCritical Severity = "critical"
)

// Alert represents a single alert instance.
type Alert struct {
	ID         string    `json:"id"`
	RuleName   string    `json:"rule_name"`
	Severity   Severity  `json:"severity"`
	Message    string    `json:"message"`
	Timestamp  time.Time  `json:"timestamp"`
	Resolved   bool       `json:"resolved"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
}

// Rule defines an alert rule with a check function.
type Rule struct {
	Name     string
	Check    func(snapshot *model.MetricsSnapshot) (fire bool, severity Severity, message string)
	Cooldown time.Duration
}

const (
	maxAlerts       = 1000
	defaultCooldown = 5 * time.Minute
)

// BroadcastFunc sends alert data to WebSocket clients.
type BroadcastFunc func(data []byte)

// Engine evaluates alert rules against metrics snapshots.
type Engine struct {
	mu        sync.RWMutex
	alerts    []Alert
	rules     []Rule
	lastFired map[string]time.Time // rule name -> last fire time
	nextID    int
	broadcast BroadcastFunc
}

// NewEngine creates a new alert engine with default rules.
func NewEngine(broadcast BroadcastFunc) *Engine {
	e := &Engine{
		alerts:    make([]Alert, 0, maxAlerts),
		lastFired: make(map[string]time.Time),
		broadcast: broadcast,
	}
	e.rules = defaultRules()
	return e
}

// Evaluate checks all rules against the given snapshot.
// Called by the aggregator on each tick.
func (e *Engine) Evaluate(snapshot *model.MetricsSnapshot) {
	now := time.Now()

	for _, rule := range e.rules {
		fire, severity, message := rule.Check(snapshot)

		if fire {
			e.mu.Lock()
			// Check cooldown
			cooldown := rule.Cooldown
			if cooldown == 0 {
				cooldown = defaultCooldown
			}
			if last, ok := e.lastFired[rule.Name]; ok && now.Sub(last) < cooldown {
				e.mu.Unlock()
				continue
			}

			// Check if there's already an active (unresolved) alert for this rule
			alreadyActive := false
			for _, a := range e.alerts {
				if a.RuleName == rule.Name && !a.Resolved {
					alreadyActive = true
					break
				}
			}
			if alreadyActive {
				e.mu.Unlock()
				continue
			}

			e.lastFired[rule.Name] = now
			alert := Alert{
				ID:        fmt.Sprintf("alert-%d", e.nextID),
				RuleName:  rule.Name,
				Severity:  severity,
				Message:   message,
				Timestamp: now,
			}
			e.nextID++
			e.addAlertLocked(alert)
			e.mu.Unlock()

			log.Warn().Str("rule", rule.Name).Str("severity", string(severity)).Msg(message)
			e.broadcastAlert(alert)
		} else {
			// Auto-resolve active alerts for this rule
			e.mu.Lock()
			for i := range e.alerts {
				if e.alerts[i].RuleName == rule.Name && !e.alerts[i].Resolved {
					e.alerts[i].Resolved = true
					e.alerts[i].ResolvedAt = &now
					log.Info().Str("rule", rule.Name).Msg("alert auto-resolved")
					e.broadcastAlertLocked(e.alerts[i])
				}
			}
			e.mu.Unlock()
		}
	}
}

func (e *Engine) addAlertLocked(a Alert) {
	if len(e.alerts) >= maxAlerts {
		// Remove oldest
		e.alerts = e.alerts[1:]
	}
	e.alerts = append(e.alerts, a)
}

func (e *Engine) broadcastAlert(a Alert) {
	if e.broadcast == nil {
		return
	}
	msg := map[string]interface{}{
		"type":  "alert",
		"alert": a,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	e.broadcast(data)
}

func (e *Engine) broadcastAlertLocked(a Alert) {
	// Same as broadcastAlert but called within lock — broadcast is goroutine-safe
	e.broadcastAlert(a)
}

// GetAlerts returns all alerts, newest first.
func (e *Engine) GetAlerts() []Alert {
	e.mu.RLock()
	defer e.mu.RUnlock()

	result := make([]Alert, len(e.alerts))
	// Reverse order (newest first)
	for i, a := range e.alerts {
		result[len(e.alerts)-1-i] = a
	}
	return result
}

// GetActiveAlerts returns unresolved alerts.
func (e *Engine) GetActiveAlerts() []Alert {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var result []Alert
	for i := len(e.alerts) - 1; i >= 0; i-- {
		if !e.alerts[i].Resolved {
			result = append(result, e.alerts[i])
		}
	}
	return result
}

// ActiveCount returns the number of unresolved alerts.
func (e *Engine) ActiveCount() int {
	e.mu.RLock()
	defer e.mu.RUnlock()

	count := 0
	for _, a := range e.alerts {
		if !a.Resolved {
			count++
		}
	}
	return count
}

// ── Default Rules ──

func defaultRules() []Rule {
	return []Rule{
		{
			Name:     "connections_warning",
			Cooldown: defaultCooldown,
			Check: func(s *model.MetricsSnapshot) (bool, Severity, string) {
				if s.PG == nil || s.PG.Connections == nil {
					return false, "", ""
				}
				c := s.PG.Connections
				if c.MaxConnections == 0 {
					return false, "", ""
				}
				ratio := float64(c.Total) / float64(c.MaxConnections)
				if ratio > 0.95 {
					return true, SeverityCritical, fmt.Sprintf("Connection count critical: %d/%d (%.0f%%)", c.Total, c.MaxConnections, ratio*100)
				}
				if ratio > 0.80 {
					return true, SeverityWarning, fmt.Sprintf("Connection count high: %d/%d (%.0f%%)", c.Total, c.MaxConnections, ratio*100)
				}
				return false, "", ""
			},
		},
		{
			Name:     "cache_hit_warning",
			Cooldown: defaultCooldown,
			Check: func(s *model.MetricsSnapshot) (bool, Severity, string) {
				if s.PG == nil {
					return false, "", ""
				}
				ratio := s.PG.CacheHitRatio
				if ratio == 0 {
					return false, "", "" // no data yet
				}
				if ratio < 95 {
					return true, SeverityCritical, fmt.Sprintf("Cache hit ratio critical: %.1f%% (below 95%%)", ratio)
				}
				if ratio < 99 {
					return true, SeverityWarning, fmt.Sprintf("Cache hit ratio low: %.1f%% (below 99%%)", ratio)
				}
				return false, "", ""
			},
		},
		{
			Name:     "cpu_usage_warning",
			Cooldown: defaultCooldown,
			Check: func(s *model.MetricsSnapshot) (bool, Severity, string) {
				if s.System == nil || s.System.CPU == nil {
					return false, "", ""
				}
				usage := s.System.CPU.UsagePercent
				if usage > 90 {
					return true, SeverityCritical, fmt.Sprintf("CPU usage critical: %.1f%%", usage)
				}
				if usage > 80 {
					return true, SeverityWarning, fmt.Sprintf("CPU usage high: %.1f%%", usage)
				}
				return false, "", ""
			},
		},
		{
			Name:     "cpu_iowait_warning",
			Cooldown: defaultCooldown,
			Check: func(s *model.MetricsSnapshot) (bool, Severity, string) {
				if s.System == nil || s.System.CPU == nil {
					return false, "", ""
				}
				iowait := s.System.CPU.IOWait
				if iowait > 20 {
					return true, SeverityWarning, fmt.Sprintf("CPU IO wait high: %.1f%%", iowait)
				}
				return false, "", ""
			},
		},
		{
			Name:     "disk_usage_warning",
			Cooldown: defaultCooldown,
			Check: func(s *model.MetricsSnapshot) (bool, Severity, string) {
				if s.System == nil {
					return false, "", ""
				}
				for _, d := range s.System.Disks {
					if d.UsedPercent > 90 {
						return true, SeverityCritical, fmt.Sprintf("Disk %s usage critical: %.1f%%", d.MountPoint, d.UsedPercent)
					}
					if d.UsedPercent > 80 {
						return true, SeverityWarning, fmt.Sprintf("Disk %s usage high: %.1f%%", d.MountPoint, d.UsedPercent)
					}
				}
				return false, "", ""
			},
		},
		{
			Name:     "memory_usage_warning",
			Cooldown: defaultCooldown,
			Check: func(s *model.MetricsSnapshot) (bool, Severity, string) {
				if s.System == nil || s.System.Memory == nil {
					return false, "", ""
				}
				usage := s.System.Memory.UsedPercent
				if usage > 95 {
					return true, SeverityCritical, fmt.Sprintf("Memory usage critical: %.1f%%", usage)
				}
				if usage > 90 {
					return true, SeverityWarning, fmt.Sprintf("Memory usage high: %.1f%%", usage)
				}
				return false, "", ""
			},
		},
	}
}

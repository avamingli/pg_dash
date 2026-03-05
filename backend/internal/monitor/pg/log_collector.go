package pg

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// severityRE matches PostgreSQL log severity levels.
// Handles both standard format "ERROR: message" and
// prefixed format "2026-03-05 ... ERROR:  message".
var severityRE = regexp.MustCompile(`\b(PANIC|FATAL|ERROR|WARNING)\s*:`)

// timestampRE extracts the leading timestamp from a PostgreSQL log line.
var timestampRE = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2})`)

const logEntryRingSize = 1000

// LogCollector reads PostgreSQL log files and counts severity levels.
type LogCollector struct {
	pool *pgxpool.Pool

	mu           sync.RWMutex
	logDir       string            // absolute path to log directory
	lastFile     string            // last file we read
	lastOffset   int64             // offset in that file
	hourlyCounts map[string]*model.HourlyLogCount // keyed by "2006-01-02T15"
	entries      []model.LogEntry  // ring buffer of parsed log entries
	entryHead    int               // next write position
	entryCount   int               // number of valid entries (up to logEntryRingSize)
	available    bool
	unavailMsg   string
}

// NewLogCollector creates a log collector that discovers PG log location via SQL.
func NewLogCollector(pool *pgxpool.Pool) *LogCollector {
	return &LogCollector{
		pool:         pool,
		hourlyCounts: make(map[string]*model.HourlyLogCount),
		entries:      make([]model.LogEntry, logEntryRingSize),
	}
}

// Init discovers the PostgreSQL log directory. Call once on startup.
func (lc *LogCollector) Init(ctx context.Context) {
	var dataDir, logDir, loggingCollector string
	err := lc.pool.QueryRow(ctx,
		"SELECT current_setting('data_directory'), current_setting('log_directory'), current_setting('logging_collector')").
		Scan(&dataDir, &logDir, &loggingCollector)
	if err != nil {
		lc.mu.Lock()
		lc.unavailMsg = fmt.Sprintf("cannot read pg_settings: %v", err)
		lc.mu.Unlock()
		log.Warn().Err(err).Msg("log collector: cannot read pg_settings")
		return
	}

	if loggingCollector != "on" {
		lc.mu.Lock()
		lc.unavailMsg = "logging_collector is off. Enable it in postgresql.conf and restart PostgreSQL to collect log statistics."
		lc.mu.Unlock()
		log.Info().Msg("log collector: logging_collector is off — log monitoring disabled")
		return
	}

	// Resolve log directory (may be relative to data_directory)
	absLogDir := logDir
	if !filepath.IsAbs(logDir) {
		absLogDir = filepath.Join(dataDir, logDir)
	}

	if _, err := os.Stat(absLogDir); err != nil {
		lc.mu.Lock()
		lc.unavailMsg = fmt.Sprintf("log directory not accessible: %s", absLogDir)
		lc.mu.Unlock()
		log.Warn().Str("dir", absLogDir).Msg("log collector: log directory not accessible")
		return
	}

	lc.mu.Lock()
	lc.logDir = absLogDir
	lc.available = true
	lc.unavailMsg = ""
	lc.mu.Unlock()

	log.Info().Str("dir", absLogDir).Msg("log collector: initialized")
}

// Collect reads new log lines and updates counts. Called on each aggregator tick.
func (lc *LogCollector) Collect(ctx context.Context) *model.LogStats {
	lc.mu.RLock()
	available := lc.available
	unavailMsg := lc.unavailMsg
	lc.mu.RUnlock()

	if !available {
		return &model.LogStats{
			Available:  false,
			Message:    unavailMsg,
		}
	}

	lc.readNewLines(ctx)

	return lc.getStats()
}

// readNewLines finds the latest log file and reads any new content.
func (lc *LogCollector) readNewLines(ctx context.Context) {
	lc.mu.RLock()
	logDir := lc.logDir
	lc.mu.RUnlock()

	// Try pg_current_logfile() first
	logFile := lc.getCurrentLogFile(ctx, logDir)
	if logFile == "" {
		// Fall back: find the most recently modified .log file
		logFile = lc.findLatestLogFile(logDir)
	}
	if logFile == "" {
		return
	}

	lc.mu.Lock()
	// If we switched to a new file, reset offset
	if logFile != lc.lastFile {
		lc.lastFile = logFile
		lc.lastOffset = 0
	}
	offset := lc.lastOffset
	lc.mu.Unlock()

	f, err := os.Open(logFile)
	if err != nil {
		log.Warn().Err(err).Str("file", logFile).Msg("log collector: cannot open log file")
		return
	}
	defer f.Close()

	// Seek to where we left off
	if offset > 0 {
		if _, err := f.Seek(offset, 0); err != nil {
			log.Warn().Err(err).Msg("log collector: seek failed, resetting")
			offset = 0
		}
	}

	hourKey := time.Now().UTC().Format("2006-01-02T15")
	var newFatal, newError, newWarning, newPanic int64

	scanner := bufio.NewScanner(f)
	// Allow up to 1MB lines (PG can have long query logs)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	bytesRead := offset
	var newEntries []model.LogEntry
	for scanner.Scan() {
		line := scanner.Text()
		bytesRead += int64(len(line)) + 1 // +1 for newline

		matches := severityRE.FindStringSubmatch(line)
		if len(matches) < 2 {
			continue
		}
		switch matches[1] {
		case "PANIC":
			newPanic++
		case "FATAL":
			newFatal++
		case "ERROR":
			newError++
		case "WARNING":
			newWarning++
		}

		// Extract timestamp and message for the entry ring buffer
		ts := time.Now().UTC().Format(time.RFC3339)
		if tsMatch := timestampRE.FindStringSubmatch(line); len(tsMatch) >= 2 {
			ts = tsMatch[1]
		}
		// Extract message after "SEVERITY:  "
		sevIdx := severityRE.FindStringIndex(line)
		msg := line
		if sevIdx != nil {
			msg = strings.TrimSpace(line[sevIdx[1]:])
		}
		newEntries = append(newEntries, model.LogEntry{
			Timestamp: ts,
			Severity:  matches[1],
			Message:   msg,
		})
	}

	lc.mu.Lock()
	lc.lastOffset = bytesRead

	// Append new entries to ring buffer
	for _, e := range newEntries {
		lc.entries[lc.entryHead] = e
		lc.entryHead = (lc.entryHead + 1) % logEntryRingSize
		if lc.entryCount < logEntryRingSize {
			lc.entryCount++
		}
	}

	entry := lc.hourlyCounts[hourKey]
	if entry == nil {
		entry = &model.HourlyLogCount{Hour: hourKey + ":00:00Z"}
		lc.hourlyCounts[hourKey] = entry
	}
	entry.Fatal += newFatal
	entry.Error += newError
	entry.Warning += newWarning
	entry.Panic += newPanic

	// Prune entries older than 24h
	cutoff := time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02T15")
	for k := range lc.hourlyCounts {
		if k < cutoff {
			delete(lc.hourlyCounts, k)
		}
	}
	lc.mu.Unlock()
}

func (lc *LogCollector) getCurrentLogFile(ctx context.Context, logDir string) string {
	var logFile *string
	err := lc.pool.QueryRow(ctx, "SELECT pg_current_logfile()").Scan(&logFile)
	if err != nil || logFile == nil || *logFile == "" {
		return ""
	}
	path := *logFile
	if !filepath.IsAbs(path) {
		// pg_current_logfile() returns path relative to data_directory
		var dataDir string
		_ = lc.pool.QueryRow(ctx, "SELECT current_setting('data_directory')").Scan(&dataDir)
		path = filepath.Join(dataDir, path)
	}
	if _, err := os.Stat(path); err != nil {
		return ""
	}
	return path
}

func (lc *LogCollector) findLatestLogFile(logDir string) string {
	entries, err := os.ReadDir(logDir)
	if err != nil {
		return ""
	}

	var latest string
	var latestTime time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(latestTime) {
			latestTime = info.ModTime()
			latest = filepath.Join(logDir, e.Name())
		}
	}
	return latest
}

// GetEntries returns recent log entries (newest-first), optionally filtered by severity.
// If severity is empty, all entries are returned. limit caps the number of results.
func (lc *LogCollector) GetEntries(severity string, limit int) []model.LogEntry {
	lc.mu.RLock()
	defer lc.mu.RUnlock()

	if lc.entryCount == 0 {
		return nil
	}
	if limit <= 0 || limit > lc.entryCount {
		limit = lc.entryCount
	}

	result := make([]model.LogEntry, 0, limit)
	// Walk backwards from newest entry
	for i := 0; i < lc.entryCount && len(result) < limit; i++ {
		idx := (lc.entryHead - 1 - i + logEntryRingSize) % logEntryRingSize
		e := lc.entries[idx]
		if severity != "" && e.Severity != severity {
			continue
		}
		result = append(result, e)
	}
	return result
}

func (lc *LogCollector) getStats() *model.LogStats {
	lc.mu.RLock()
	defer lc.mu.RUnlock()

	stats := &model.LogStats{
		Available: lc.available,
		LogFile:   lc.lastFile,
	}

	// Build sorted hourly counts and compute totals (last 24h)
	for _, entry := range lc.hourlyCounts {
		e := *entry // copy
		stats.HourlyCounts = append(stats.HourlyCounts, e)
		stats.FatalCount += e.Fatal
		stats.ErrorCount += e.Error
		stats.WarningCount += e.Warning
		stats.PanicCount += e.Panic
	}

	sort.Slice(stats.HourlyCounts, func(i, j int) bool {
		return stats.HourlyCounts[i].Hour < stats.HourlyCounts[j].Hour
	})

	return stats
}

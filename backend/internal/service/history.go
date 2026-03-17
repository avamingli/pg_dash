package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// stmtSnap is one row from pg_stat_statements used for diff tracking.
type stmtSnap struct {
	QueryID         int64
	Username        string
	Database        string
	Query           string
	Calls           int64
	TotalExecTime   float64
	MeanExecTime    float64
	Rows            int64
	SharedBlksHit   int64
	SharedBlksRead  int64
	TempBlksWritten int64
	WALBytes        int64
}

// HistoryService collects query history from pg_stat_statements diffs.
type HistoryService struct {
	pool      *pgxpool.Pool
	retention time.Duration
	tick      time.Duration
	mu        sync.RWMutex
	prevSnap  map[int64]*stmtSnap // queryid -> snapshot
	available bool
	cancel    context.CancelFunc
}

// NewHistoryService creates a new history service.
func NewHistoryService(pool *pgxpool.Pool) *HistoryService {
	return &HistoryService{
		pool:      pool,
		retention: 7 * 24 * time.Hour,
		tick:      60 * time.Second,
		prevSnap:  make(map[int64]*stmtSnap),
	}
}

// Init creates the history table if it does not exist and checks for pg_stat_statements.
func (h *HistoryService) Init(ctx context.Context) error {
	// Check if pg_stat_statements is available
	var count int
	if err := h.pool.QueryRow(ctx, query.StatementsAvailable).Scan(&count); err != nil || count == 0 {
		log.Warn().Msg("history: pg_stat_statements not available — query history collection disabled")
		return nil
	}
	h.available = true

	// Create table
	if _, err := h.pool.Exec(ctx, query.HistoryTableDDL); err != nil {
		return fmt.Errorf("history: create table: %w", err)
	}

	// Create indexes
	if _, err := h.pool.Exec(ctx, query.HistoryIndexDDL); err != nil {
		log.Warn().Err(err).Msg("history: create indexes failed (non-fatal)")
	}

	log.Info().Msg("history: initialized dbhouse_query_history table")
	return nil
}

// Start begins periodic collection and cleanup goroutines.
func (h *HistoryService) Start(ctx context.Context) {
	if !h.available {
		return
	}

	ctx, h.cancel = context.WithCancel(ctx)

	// Take initial snapshot
	h.takeSnapshot(ctx)

	// Collection goroutine
	go func() {
		ticker := time.NewTicker(h.tick)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.collectDiff(ctx)
			}
		}
	}()

	// Cleanup goroutine
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanup(ctx)
			}
		}
	}()

	log.Info().Dur("interval", h.tick).Msg("history: collection started")
}

// Stop stops the collection goroutines.
func (h *HistoryService) Stop() {
	if h.cancel != nil {
		h.cancel()
	}
}

// IsAvailable returns true if pg_stat_statements is available.
func (h *HistoryService) IsAvailable() bool {
	return h.available
}

func (h *HistoryService) takeSnapshot(ctx context.Context) {
	rows, err := h.pool.Query(ctx, query.StatementsSnapshot)
	if err != nil {
		log.Warn().Err(err).Msg("history: snapshot query failed")
		return
	}
	defer rows.Close()

	snap := make(map[int64]*stmtSnap)
	for rows.Next() {
		s := &stmtSnap{}
		if err := rows.Scan(&s.QueryID, &s.Username, &s.Database, &s.Query,
			&s.Calls, &s.TotalExecTime, &s.MeanExecTime, &s.Rows,
			&s.SharedBlksHit, &s.SharedBlksRead, &s.TempBlksWritten, &s.WALBytes); err != nil {
			continue
		}
		snap[s.QueryID] = s
	}

	h.mu.Lock()
	h.prevSnap = snap
	h.mu.Unlock()
}

func (h *HistoryService) collectDiff(ctx context.Context) {
	rows, err := h.pool.Query(ctx, query.StatementsSnapshot)
	if err != nil {
		log.Warn().Err(err).Msg("history: snapshot query failed")
		return
	}
	defer rows.Close()

	now := time.Now()
	newSnap := make(map[int64]*stmtSnap)
	var insertCount int

	h.mu.RLock()
	prev := h.prevSnap
	h.mu.RUnlock()

	for rows.Next() {
		s := &stmtSnap{}
		if err := rows.Scan(&s.QueryID, &s.Username, &s.Database, &s.Query,
			&s.Calls, &s.TotalExecTime, &s.MeanExecTime, &s.Rows,
			&s.SharedBlksHit, &s.SharedBlksRead, &s.TempBlksWritten, &s.WALBytes); err != nil {
			continue
		}
		newSnap[s.QueryID] = s

		// Check for new calls since last snapshot
		old, exists := prev[s.QueryID]
		if !exists {
			continue
		}
		deltaCalls := s.Calls - old.Calls
		if deltaCalls <= 0 {
			continue
		}

		// Insert history entry for the delta
		deltaTime := s.TotalExecTime - old.TotalExecTime
		deltaRows := s.Rows - old.Rows
		deltaHit := s.SharedBlksHit - old.SharedBlksHit
		deltaRead := s.SharedBlksRead - old.SharedBlksRead
		deltaTemp := s.TempBlksWritten - old.TempBlksWritten
		deltaWAL := s.WALBytes - old.WALBytes
		submittedAt := now.Add(-time.Duration(deltaTime) * time.Millisecond)

		_, err := h.pool.Exec(ctx, query.HistoryInsert,
			s.QueryID, s.Database, s.Username, s.Query, "done",
			submittedAt, now, deltaTime, deltaRows,
			deltaHit, deltaRead, deltaTemp, deltaWAL,
			deltaCalls, s.MeanExecTime,
		)
		if err != nil {
			log.Debug().Err(err).Int64("queryid", s.QueryID).Msg("history: insert failed")
			continue
		}
		insertCount++
	}

	h.mu.Lock()
	h.prevSnap = newSnap
	h.mu.Unlock()

	if insertCount > 0 {
		log.Debug().Int("inserted", insertCount).Msg("history: collected query diffs")
	}
}

func (h *HistoryService) cleanup(ctx context.Context) {
	result, err := h.pool.Exec(ctx, query.HistoryCleanup, h.retention.String())
	if err != nil {
		log.Warn().Err(err).Msg("history: cleanup failed")
		return
	}
	if result.RowsAffected() > 0 {
		log.Info().Int64("deleted", result.RowsAffected()).Msg("history: cleaned up old entries")
	}
}

// GetByID returns a single history entry by ID.
func (h *HistoryService) GetByID(ctx context.Context, id int64) (*model.QueryHistoryEntry, error) {
	var e model.QueryHistoryEntry
	err := h.pool.QueryRow(ctx, `
		SELECT id, queryid, database, username, query_text, status,
		       submitted_at, ended_at, duration_ms, rows_affected,
		       shared_blks_hit, shared_blks_read, temp_blks_written,
		       wal_bytes, calls, mean_exec_time
		FROM dbhouse_query_history WHERE id = $1`, id).Scan(
		&e.ID, &e.QueryID, &e.Database, &e.Username,
		&e.QueryText, &e.Status, &e.SubmittedAt, &e.EndedAt,
		&e.DurationMs, &e.RowsAffected, &e.SharedBlksHit, &e.SharedBlksRead,
		&e.TempBlksWritten, &e.WALBytes, &e.Calls, &e.MeanExecTime)
	if err != nil {
		return nil, fmt.Errorf("history.GetByID: %w", err)
	}
	return &e, nil
}

// Stats returns summary statistics about the history table.
func (h *HistoryService) Stats(ctx context.Context) (map[string]interface{}, error) {
	var total int64
	var earliest, latest *time.Time
	err := h.pool.QueryRow(ctx, `
		SELECT count(*), min(submitted_at), max(submitted_at)
		FROM dbhouse_query_history`).Scan(&total, &earliest, &latest)
	if err != nil {
		return nil, fmt.Errorf("history.Stats: %w", err)
	}
	result := map[string]interface{}{
		"total_entries": total,
		"available":     true,
	}
	if earliest != nil {
		result["earliest"] = earliest
	}
	if latest != nil {
		result["latest"] = latest
	}
	return result, nil
}

// Search queries the history table with dynamic filters.
func (h *HistoryService) Search(ctx context.Context, params map[string]string) (*model.QueryHistoryResponse, error) {
	// Build WHERE clauses
	var conditions []string
	var args []interface{}
	argIdx := 1

	if v := params["username"]; v != "" {
		conditions = append(conditions, fmt.Sprintf("username = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := params["database"]; v != "" {
		conditions = append(conditions, fmt.Sprintf("database = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := params["query_text"]; v != "" {
		conditions = append(conditions, fmt.Sprintf("query_text ILIKE $%d", argIdx))
		args = append(args, "%"+v+"%")
		argIdx++
	}
	if v := params["min_duration"]; v != "" {
		if dur, err := strconv.ParseFloat(v, 64); err == nil {
			conditions = append(conditions, fmt.Sprintf("duration_ms >= $%d", argIdx))
			args = append(args, dur)
			argIdx++
		}
	}
	if v := params["status"]; v != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := params["from"]; v != "" {
		conditions = append(conditions, fmt.Sprintf("submitted_at >= $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := params["to"]; v != "" {
		conditions = append(conditions, fmt.Sprintf("submitted_at <= $%d", argIdx))
		args = append(args, v)
		argIdx++
	}

	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}

	// Count total
	var total int64
	countSQL := "SELECT count(*) FROM dbhouse_query_history" + where
	if err := h.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("history.Search: count: %w", err)
	}

	// Order
	orderBy := "submitted_at"
	if v := params["order_by"]; v != "" {
		// Whitelist allowed columns
		switch v {
		case "duration_ms", "submitted_at", "calls", "username", "database":
			orderBy = v
		}
	}
	orderDir := "DESC"
	if v := params["order_dir"]; v == "asc" {
		orderDir = "ASC"
	}

	// Pagination
	limit := 50
	if v := params["limit"]; v != "" {
		if l, err := strconv.Atoi(v); err == nil && l > 0 && l <= 500 {
			limit = l
		}
	}
	offset := 0
	if v := params["offset"]; v != "" {
		if o, err := strconv.Atoi(v); err == nil && o >= 0 {
			offset = o
		}
	}

	selectSQL := fmt.Sprintf(`
		SELECT id, queryid, database, username, query_text, status,
		       submitted_at, ended_at, duration_ms, rows_affected,
		       shared_blks_hit, shared_blks_read, temp_blks_written,
		       wal_bytes, calls, mean_exec_time
		FROM dbhouse_query_history%s
		ORDER BY %s %s
		LIMIT %d OFFSET %d`, where, orderBy, orderDir, limit, offset)

	rows, err := h.pool.Query(ctx, selectSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("history.Search: query: %w", err)
	}
	defer rows.Close()

	var entries []model.QueryHistoryEntry
	for rows.Next() {
		var e model.QueryHistoryEntry
		if err := rows.Scan(&e.ID, &e.QueryID, &e.Database, &e.Username,
			&e.QueryText, &e.Status, &e.SubmittedAt, &e.EndedAt,
			&e.DurationMs, &e.RowsAffected, &e.SharedBlksHit, &e.SharedBlksRead,
			&e.TempBlksWritten, &e.WALBytes, &e.Calls, &e.MeanExecTime); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	if entries == nil {
		entries = []model.QueryHistoryEntry{}
	}

	return &model.QueryHistoryResponse{
		Entries: entries,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
	}, nil
}

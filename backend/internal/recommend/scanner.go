package recommend

import (
	"context"
	"fmt"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// Scanner performs health scans on the monitored database.
type Scanner struct {
	pool        *pgxpool.Pool
	clusterInfo *service.ClusterInfo
}

// NewScanner creates a new recommendation scanner.
func NewScanner(pool *pgxpool.Pool, ci *service.ClusterInfo) *Scanner {
	return &Scanner{pool: pool, clusterInfo: ci}
}

// Scan runs all recommendation checks and returns aggregated results.
func (s *Scanner) Scan(ctx context.Context) (*model.ScanResult, error) {
	start := time.Now()
	var all []model.Recommendation

	scanners := []struct {
		name string
		fn   func(context.Context) []model.Recommendation
	}{
		{"xid_age", s.scanXIDAge},
		{"dead_tuples", s.scanDeadTuples},
		{"stale_stats", s.scanStaleStats},
		{"unused_indexes", s.scanUnusedIndexes},
		{"duplicate_indexes", s.scanDuplicateIndexes},
		{"index_bloat", s.scanIndexBloat},
	}

	// Add data skew scan for distributed mode
	if s.clusterInfo != nil && s.clusterInfo.IsDistributed() {
		scanners = append(scanners, struct {
			name string
			fn   func(context.Context) []model.Recommendation
		}{"data_skew", s.scanDataSkew})
	}

	for _, sc := range scanners {
		recs := sc.fn(ctx)
		if len(recs) > 0 {
			log.Debug().Str("scan", sc.name).Int("findings", len(recs)).Msg("scan complete")
		}
		all = append(all, recs...)
	}

	// Build summary
	summary := model.ScanSummary{
		Total:      len(all),
		ByCategory: make(map[string]int),
	}
	for _, r := range all {
		switch r.Severity {
		case "critical":
			summary.Critical++
		case "warning":
			summary.Warning++
		case "info":
			summary.Info++
		}
		summary.ByCategory[r.Category]++
	}

	return &model.ScanResult{
		ScannedAt:       start,
		DurationMs:      time.Since(start).Milliseconds(),
		Recommendations: all,
		Summary:         summary,
	}, nil
}

func (s *Scanner) scanXIDAge(ctx context.Context) []model.Recommendation {
	var recs []model.Recommendation

	// Database-level XID age
	rows, err := s.pool.Query(ctx, query.XIDAgeDatabases)
	if err != nil {
		log.Warn().Err(err).Msg("scanXIDAge: database query failed")
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var datname string
		var age int64
		var pct float64
		if err := rows.Scan(&datname, &age, &pct); err != nil {
			continue
		}
		if age < 500_000_000 {
			continue
		}
		sev := "warning"
		if age > 1_000_000_000 {
			sev = "critical"
		}
		recs = append(recs, model.Recommendation{
			Category:   "xid_age",
			Severity:   sev,
			Database:   datname,
			Schema:     "",
			Table:      "",
			CurrentVal: fmt.Sprintf("age %d (%.1f%%)", age, pct),
			Threshold:  "500,000,000 (warning) / 1,000,000,000 (critical)",
			Message:    fmt.Sprintf("Database %s XID age is %d (%.1f%% of wraparound limit)", datname, age, pct),
			Action:     "Run VACUUM FREEZE on high-age tables",
			ActionSQL:  fmt.Sprintf("VACUUM FREEZE"),
		})
	}

	// Table-level XID age
	tRows, err := s.pool.Query(ctx, query.XIDAgeTables, int64(500_000_000))
	if err != nil {
		return recs
	}
	defer tRows.Close()

	for tRows.Next() {
		var schema, relname, lastVac string
		var age int64
		var pct float64
		var size int64
		if err := tRows.Scan(&schema, &relname, &age, &pct, &size, &lastVac); err != nil {
			continue
		}
		sev := "warning"
		if age > 1_000_000_000 {
			sev = "critical"
		}
		recs = append(recs, model.Recommendation{
			Category:   "xid_age",
			Severity:   sev,
			Schema:     schema,
			Table:      relname,
			CurrentVal: fmt.Sprintf("age %d (%.1f%%)", age, pct),
			Threshold:  "500M / 1B",
			Message:    fmt.Sprintf("Table %s.%s XID age %d (%.1f%%), last vacuum: %s", schema, relname, age, pct, lastVac),
			Action:     "VACUUM FREEZE",
			ActionSQL:  fmt.Sprintf("VACUUM FREEZE %s.%s", schema, relname),
			SizeBytes:  size,
		})
	}

	return recs
}

func (s *Scanner) scanDeadTuples(ctx context.Context) []model.Recommendation {
	var recs []model.Recommendation
	rows, err := s.pool.Query(ctx, query.HighDeadTupleTables, float64(10))
	if err != nil {
		log.Warn().Err(err).Msg("scanDeadTuples: query failed")
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var schema, relname, lastVac string
		var live, dead, size int64
		var pct float64
		if err := rows.Scan(&schema, &relname, &live, &dead, &pct, &size, &lastVac); err != nil {
			continue
		}
		sev := "warning"
		action := "VACUUM"
		actionSQL := fmt.Sprintf("VACUUM %s.%s", schema, relname)
		if pct > 50 {
			sev = "critical"
			action = "VACUUM FULL"
			actionSQL = fmt.Sprintf("VACUUM FULL %s.%s", schema, relname)
		} else if pct > 20 {
			sev = "critical"
		}
		recs = append(recs, model.Recommendation{
			Category:   "dead_tuples",
			Severity:   sev,
			Schema:     schema,
			Table:      relname,
			CurrentVal: fmt.Sprintf("%.1f%% (%d dead / %d live)", pct, dead, live),
			Threshold:  "10% (warning) / 20% (critical)",
			Message:    fmt.Sprintf("%s.%s has %.1f%% dead tuples, last vacuum: %s", schema, relname, pct, lastVac),
			Action:     action,
			ActionSQL:  actionSQL,
			SizeBytes:  size,
		})
	}
	return recs
}

func (s *Scanner) scanStaleStats(ctx context.Context) []model.Recommendation {
	var recs []model.Recommendation
	rows, err := s.pool.Query(ctx, query.StaleStatsTables)
	if err != nil {
		log.Warn().Err(err).Msg("scanStaleStats: query failed")
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var schema, relname string
		var liveTup, modSince, size int64
		var lastAnalyze *time.Time
		if err := rows.Scan(&schema, &relname, &liveTup, &modSince, &lastAnalyze, &size); err != nil {
			continue
		}
		analyzeStr := "never"
		if lastAnalyze != nil {
			analyzeStr = lastAnalyze.Format("2006-01-02 15:04")
		}
		sev := "warning"
		if lastAnalyze == nil {
			sev = "critical"
		}
		recs = append(recs, model.Recommendation{
			Category:   "stale_stats",
			Severity:   sev,
			Schema:     schema,
			Table:      relname,
			CurrentVal: fmt.Sprintf("%d modifications since last analyze", modSince),
			Threshold:  "> 1000 mods AND > 7 days since ANALYZE",
			Message:    fmt.Sprintf("%s.%s has %d modifications, last analyzed: %s", schema, relname, modSince, analyzeStr),
			Action:     "ANALYZE",
			ActionSQL:  fmt.Sprintf("ANALYZE %s.%s", schema, relname),
			SizeBytes:  size,
		})
	}
	return recs
}

func (s *Scanner) scanUnusedIndexes(ctx context.Context) []model.Recommendation {
	var recs []model.Recommendation
	rows, err := s.pool.Query(ctx, query.UnusedIndexes)
	if err != nil {
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var schema, relname, indexname string
		var size int64
		var idxScan int64
		var isUnique, isPrimary bool
		if err := rows.Scan(&schema, &relname, &indexname, &size, &idxScan, &isUnique, &isPrimary); err != nil {
			continue
		}
		recs = append(recs, model.Recommendation{
			Category:   "unused_index",
			Severity:   "info",
			Schema:     schema,
			Table:      relname,
			CurrentVal: fmt.Sprintf("0 scans since stats reset, index: %s", indexname),
			Threshold:  "0 scans",
			Message:    fmt.Sprintf("Index %s.%s on %s.%s has never been scanned", schema, indexname, schema, relname),
			Action:     "Consider DROP INDEX",
			ActionSQL:  fmt.Sprintf("DROP INDEX %s.%s", schema, indexname),
			SizeBytes:  size,
		})
	}
	return recs
}

func (s *Scanner) scanDuplicateIndexes(ctx context.Context) []model.Recommendation {
	var recs []model.Recommendation
	rows, err := s.pool.Query(ctx, query.DuplicateIndexes)
	if err != nil {
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var schema, relname, idx1, idx2 string
		var idx1Size, idx2Size int64
		if err := rows.Scan(&schema, &relname, &idx1, &idx2, &idx1Size, &idx2Size); err != nil {
			continue
		}
		recs = append(recs, model.Recommendation{
			Category:   "duplicate_index",
			Severity:   "info",
			Schema:     schema,
			Table:      relname,
			CurrentVal: fmt.Sprintf("%s and %s (same column set)", idx1, idx2),
			Threshold:  "same column set",
			Message:    fmt.Sprintf("Duplicate indexes %s and %s on %s.%s", idx1, idx2, schema, relname),
			Action:     "Consider dropping one",
			ActionSQL:  fmt.Sprintf("DROP INDEX %s.%s", schema, idx2),
			SizeBytes:  idx2Size,
		})
	}
	return recs
}

func (s *Scanner) scanIndexBloat(ctx context.Context) []model.Recommendation {
	var recs []model.Recommendation
	rows, err := s.pool.Query(ctx, query.IndexBloat)
	if err != nil {
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var schema, relname, indexname string
		var realSize, expectedSize, bloatBytes int64
		var bloatPct float64
		if err := rows.Scan(&schema, &relname, &indexname, &realSize, &expectedSize, &bloatBytes, &bloatPct); err != nil {
			continue
		}
		if bloatPct < 30 {
			continue
		}
		sev := "info"
		if bloatPct > 70 {
			sev = "warning"
		}
		recs = append(recs, model.Recommendation{
			Category:   "index_bloat",
			Severity:   sev,
			Schema:     schema,
			Table:      relname,
			CurrentVal: fmt.Sprintf("%.1f%% bloat on %s", bloatPct, indexname),
			Threshold:  "30% (info) / 70% (warning)",
			Message:    fmt.Sprintf("Index %s.%s is %.1f%% bloated", schema, indexname, bloatPct),
			Action:     "REINDEX",
			ActionSQL:  fmt.Sprintf("REINDEX INDEX %s.%s", schema, indexname),
			SizeBytes:  realSize,
		})
	}
	return recs
}

func (s *Scanner) scanDataSkew(ctx context.Context) []model.Recommendation {
	var recs []model.Recommendation
	rows, err := s.pool.Query(ctx, query.DataSkewCoefficients)
	if err != nil {
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var schema, relname string
		var coeff float64
		if err := rows.Scan(&schema, &relname, &coeff); err != nil {
			continue
		}
		sev := "warning"
		if coeff > 20 {
			sev = "critical"
		}
		recs = append(recs, model.Recommendation{
			Category:   "skew",
			Severity:   sev,
			Schema:     schema,
			Table:      relname,
			CurrentVal: fmt.Sprintf("skew coefficient %.1f", coeff),
			Threshold:  "> 5 (warning) / > 20 (critical)",
			Message:    fmt.Sprintf("%s.%s has data skew coefficient %.1f — uneven distribution across segments", schema, relname, coeff),
			Action:     "Review distribution key",
			ActionSQL:  fmt.Sprintf("SELECT gp_segment_id, count(*) FROM %s.%s GROUP BY 1 ORDER BY 2 DESC", schema, relname),
		})
	}
	return recs
}

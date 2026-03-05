package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// writeJSON encodes data as JSON and writes it to the response.
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// writeError writes a JSON error response with the given status code.
func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": msg,
		"code":  code,
	})
}

// sanitizeValue converts pgtype structs that don't serialize cleanly to
// JSON-friendly representations.
func sanitizeValue(v any) any {
	switch val := v.(type) {
	case pgtype.Interval:
		if !val.Valid {
			return nil
		}
		// Convert to human-readable string like "5 days 03:21:45"
		totalSeconds := val.Microseconds / 1_000_000
		hours := totalSeconds / 3600
		minutes := (totalSeconds % 3600) / 60
		seconds := totalSeconds % 60
		result := ""
		if val.Months > 0 {
			years := val.Months / 12
			months := val.Months % 12
			if years > 0 {
				result += fmt.Sprintf("%d years ", years)
			}
			if months > 0 {
				result += fmt.Sprintf("%d mons ", months)
			}
		}
		if val.Days > 0 {
			result += fmt.Sprintf("%d days ", val.Days)
		}
		result += fmt.Sprintf("%02d:%02d:%02d", hours, minutes, seconds)
		return result
	default:
		return v
	}
}

// sanitizeMap converts all values in a map through sanitizeValue.
func sanitizeMap(m map[string]any) map[string]any {
	for k, v := range m {
		m[k] = sanitizeValue(v)
	}
	return m
}

// queryRows executes a query and returns all rows as []map[string]any.
// This is the primary helper for handlers that return tabular data as JSON.
// All pgtype structs are sanitized to JSON-friendly values.
func queryRows(ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) ([]map[string]any, error) {
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result, err := pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return nil, err
	}
	for i := range result {
		sanitizeMap(result[i])
	}
	return result, nil
}

// queryRow executes a query and returns a single row as map[string]any.
// All pgtype structs are sanitized to JSON-friendly values.
func queryRow(ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) (map[string]any, error) {
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m, err := pgx.CollectOneRow(rows, pgx.RowToMap)
	if err != nil {
		return nil, err
	}
	return sanitizeMap(m), nil
}

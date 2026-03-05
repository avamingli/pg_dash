package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterQueryRoutes(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/queries/top", topQueriesHandler(pool))
	r.Post("/query/execute", executeQueryHandler(pool))
	r.Post("/query/explain", explainQueryHandler(pool))
	r.Post("/statements/reset", resetStatementsHandler(pool))
}

func topQueriesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Check if pg_stat_statements is available — gracefully degrade with empty result
		var available bool
		if err := pool.QueryRow(ctx, query.StatementsAvailable).Scan(&available); err != nil || !available {
			writeJSON(w, map[string]interface{}{
				"queries": []any{},
				"message": "pg_stat_statements extension is not installed. Run: CREATE EXTENSION pg_stat_statements;",
			})
			return
		}

		by := r.URL.Query().Get("by")
		limitStr := r.URL.Query().Get("limit")
		limit := 20
		if limitStr != "" {
			if v, err := strconv.Atoi(limitStr); err == nil && v > 0 && v <= 100 {
				limit = v
			}
		}

		var sql string
		switch by {
		case "calls":
			sql = query.TopQuerysByCalls
		case "rows":
			sql = query.TopQuerysByRows
		case "temp":
			sql = query.TopQuerysByTemp
		default:
			sql = query.TopQuerysByTotalTime
		}

		rows, err := queryRows(ctx, pool, sql, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, rows)
	}
}

// executeRequest is the JSON body for the execute/explain endpoints.
type executeRequest struct {
	SQL      string `json:"sql"`
	ReadOnly bool   `json:"read_only"`
}

func executeQueryHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req executeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
			return
		}
		if strings.TrimSpace(req.SQL) == "" {
			writeError(w, http.StatusBadRequest, "sql field is required")
			return
		}

		ctx := r.Context()

		// Execute within a read-only transaction if requested
		txOpts := pgx.TxOptions{}
		if req.ReadOnly {
			txOpts.AccessMode = pgx.ReadOnly
		}

		tx, err := pool.BeginTx(ctx, txOpts)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer tx.Rollback(ctx)

		rows, err := tx.Query(ctx, req.SQL)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		defer rows.Close()

		// Collect column names
		fields := rows.FieldDescriptions()
		columns := make([]string, len(fields))
		for i, fd := range fields {
			columns[i] = fd.Name
		}

		// Collect all rows
		var resultRows []map[string]any
		for rows.Next() {
			values, err := rows.Values()
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			row := make(map[string]any, len(columns))
			for i, col := range columns {
				row[col] = sanitizeValue(values[i])
			}
			resultRows = append(resultRows, row)
		}
		if err := rows.Err(); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		if req.ReadOnly {
			tx.Rollback(ctx)
		} else {
			tx.Commit(ctx)
		}

		writeJSON(w, map[string]interface{}{
			"columns":   columns,
			"rows":      resultRows,
			"row_count": len(resultRows),
		})
	}
}

func explainQueryHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			SQL     string `json:"sql"`
			Analyze bool   `json:"analyze"`
			Buffers bool   `json:"buffers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
			return
		}
		if strings.TrimSpace(req.SQL) == "" {
			writeError(w, http.StatusBadRequest, "sql field is required")
			return
		}

		// Build EXPLAIN prefix
		opts := []string{"FORMAT JSON"}
		if req.Analyze {
			opts = append(opts, "ANALYZE")
		}
		if req.Buffers {
			opts = append(opts, "BUFFERS")
		}
		explainSQL := fmt.Sprintf("EXPLAIN (%s) %s", strings.Join(opts, ", "), req.SQL)

		ctx := r.Context()

		// Run EXPLAIN in a transaction that we always rollback (to avoid side effects from ANALYZE)
		tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer tx.Rollback(ctx)

		var planJSON []byte
		err = tx.QueryRow(ctx, explainSQL).Scan(&planJSON)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		tx.Rollback(ctx)

		// Parse the JSON plan
		var plan interface{}
		json.Unmarshal(planJSON, &plan)

		writeJSON(w, map[string]interface{}{
			"plan": plan,
			"sql":  req.SQL,
		})
	}
}

func resetStatementsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		var available bool
		if err := pool.QueryRow(ctx, query.StatementsAvailable).Scan(&available); err != nil || !available {
			writeError(w, http.StatusServiceUnavailable, "pg_stat_statements extension is not installed. Run: CREATE EXTENSION pg_stat_statements;")
			return
		}

		_, err := pool.Exec(ctx, query.StatementsReset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{"status": "ok"})
	}
}

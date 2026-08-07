package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/avamingli/dbhouse-web/backend/internal/query"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterQueryRoutes(r chi.Router, pool *pgxpool.Pool, connMgr *service.ConnectionManager) {
	r.Get("/queries/top", topQueriesHandler(pool))
	r.Post("/query/execute", executeQueryHandler(pool, connMgr))
	r.Post("/query/explain", explainQueryHandler(pool, connMgr))
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
	Database string `json:"database"` // optional; defaults to the PG_DSN database
}

// collectRows reads every row out of a pgx.Rows into a JSON-friendly shape.
// The returned rows slice is always non-nil (even with zero rows) — a nil
// slice marshals to JSON `null`, but the frontend always expects an array
// (e.g. DDL statements return zero rows).
func collectRows(rows pgx.Rows) (columns []string, resultRows []map[string]any, err error) {
	fields := rows.FieldDescriptions()
	columns = make([]string, len(fields))
	for i, fd := range fields {
		columns[i] = fd.Name
	}

	resultRows = make([]map[string]any, 0)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, nil, err
		}
		row := make(map[string]any, len(columns))
		for i, col := range columns {
			row[col] = sanitizeValue(values[i])
		}
		resultRows = append(resultRows, row)
	}
	return columns, resultRows, rows.Err()
}

// isMultiStatementError reports whether err is pgx's rejection of a SQL
// string containing more than one statement — pgx always prepares a query
// (extended protocol) to bind parameters/get a description, and Postgres
// refuses to prepare more than one command at once. The SQL Editor lets
// users paste ad hoc scripts (e.g. "SET optimizer=off; SELECT ..."), which
// hits this on every multi-statement paste.
func isMultiStatementError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "cannot insert multiple commands into a prepared statement")
}

// execMultiStatement runs a multi-statement SQL string via the simple query
// protocol (bypassing pgx's Query, which can't prepare more than one
// command) and returns the *last* statement's result — matching what a
// human pasting "SET ...; SELECT ..." into psql actually wants to see.
// Values are decoded through the same type map pgx's own Rows.Values() uses,
// so results keep native JSON typing (numbers stay numbers, not "123"
// strings) despite going through the lower-level pgconn API to get at every
// statement's result instead of just the first.
func execMultiStatement(ctx context.Context, pool *pgxpool.Pool, sql string, readOnly bool) (columns []string, resultRows []map[string]any, err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("execMultiStatement: %w", err)
	}
	defer conn.Release()

	if readOnly {
		sql = "BEGIN READ ONLY; " + sql + "; ROLLBACK;"
	}

	mrr := conn.Conn().PgConn().Exec(ctx, sql)
	results, err := mrr.ReadAll()
	if err != nil {
		return nil, nil, err
	}
	if len(results) == 0 {
		return make([]string, 0), make([]map[string]any, 0), nil
	}
	// Take the last result that actually has columns, not just the literal
	// last statement — for read_only we append "; ROLLBACK" after the user's
	// SQL, which would otherwise always win and hide their real result.
	last := results[len(results)-1]
	for i := len(results) - 1; i >= 0; i-- {
		if len(results[i].FieldDescriptions) > 0 {
			last = results[i]
			break
		}
	}
	if last.Err != nil {
		return nil, nil, last.Err
	}

	typeMap := conn.Conn().TypeMap()
	columns = make([]string, len(last.FieldDescriptions))
	for i, fd := range last.FieldDescriptions {
		columns[i] = fd.Name
	}
	resultRows = make([]map[string]any, 0, len(last.Rows))
	for _, rawRow := range last.Rows {
		row := make(map[string]any, len(columns))
		for i, raw := range rawRow {
			if raw == nil {
				row[columns[i]] = nil
				continue
			}
			fd := last.FieldDescriptions[i]
			var value any
			if dt, ok := typeMap.TypeForOID(fd.DataTypeOID); ok {
				value, err = dt.Codec.DecodeValue(typeMap, fd.DataTypeOID, fd.Format, raw)
				if err != nil {
					return nil, nil, err
				}
			} else {
				value = string(raw)
			}
			row[columns[i]] = sanitizeValue(value)
		}
		resultRows = append(resultRows, row)
	}
	return columns, resultRows, nil
}

func executeQueryHandler(defaultPool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
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

		// Each request resolves its own pool — never mutate defaultPool, it's
		// shared (captured once) across every concurrent call to this handler.
		pool := defaultPool
		if req.Database != "" {
			dbPool, err := connMgr.GetPoolForDB(ctx, req.Database)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			pool = dbPool
		}

		var columns []string
		var resultRows []map[string]any

		if req.ReadOnly {
			// Wrap in an explicit read-only transaction, always rolled back,
			// as a safety net against any statement that tries to write.
			tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			defer tx.Rollback(ctx)

			rows, err := tx.Query(ctx, req.SQL)
			if isMultiStatementError(err) {
				tx.Rollback(ctx)
				columns, resultRows, err = execMultiStatement(ctx, pool, req.SQL, true)
			} else if err == nil {
				columns, resultRows, err = collectRows(rows)
				rows.Close()
				tx.Rollback(ctx)
			}
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		} else {
			// Run directly against the pool — no explicit transaction. Some
			// statements (CREATE DATABASE, VACUUM, CREATE INDEX CONCURRENTLY,
			// ALTER SYSTEM, ...) refuse to run inside a transaction block at
			// all, so wrapping every write in one would break them.
			rows, err := pool.Query(ctx, req.SQL)
			if isMultiStatementError(err) {
				columns, resultRows, err = execMultiStatement(ctx, pool, req.SQL, false)
			} else if err == nil {
				columns, resultRows, err = collectRows(rows)
				rows.Close()
			}
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}

		writeJSON(w, map[string]interface{}{
			"columns":   columns,
			"rows":      resultRows,
			"row_count": len(resultRows),
		})
	}
}

func explainQueryHandler(defaultPool *pgxpool.Pool, connMgr *service.ConnectionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			SQL      string `json:"sql"`
			Analyze  bool   `json:"analyze"`
			Buffers  bool   `json:"buffers"`
			Database string `json:"database"`
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

		// Each request resolves its own pool — never mutate defaultPool, it's
		// shared (captured once) across every concurrent call to this handler.
		pool := defaultPool
		if req.Database != "" {
			dbPool, err := connMgr.GetPoolForDB(ctx, req.Database)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			pool = dbPool
		}

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

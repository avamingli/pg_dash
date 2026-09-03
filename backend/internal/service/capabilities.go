package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Capabilities records which version- or fork-specific catalog columns/views
// are actually present on the connected server. Different PostgreSQL major
// versions add, rename, or drop stats columns over time (e.g. pg_stat_wal
// only exists from PG 14 on, pg_stat_checkpointer only from PG 17), and MPP
// forks (Cloudberry, Greenplum, WarehousePG) commonly track an older
// PostgreSQL base than their own release number suggests — but they don't
// always match a PostgreSQL version cleanly either: WarehousePG backports
// pg_stat_wal onto its PG12 base but calls one of its columns wal_fpw where
// upstream PG 14+ calls it wal_fpi. Probing actual catalog columns once per
// connection (instead of hardcoding version-number thresholds) stays correct
// for both kinds of drift.
type Capabilities struct {
	ActivityQueryID         bool // pg_stat_activity.query_id (PG 14+)
	DatabaseSessionStats    bool // pg_stat_database.session_time et al (PG 14+)
	StatCheckpointer        bool // pg_stat_checkpointer view (PG 17+)
	ReplicationSlotInactive bool // pg_replication_slots.inactive_since (PG 17+)
	StatWAL                 bool // pg_stat_wal view
	StatWALFPIColumn        string // "wal_fpi" (upstream) or "wal_fpw" (WarehousePG); "" if !StatWAL
	TableInsertsSinceVacuum bool // pg_stat_user_tables.n_ins_since_vacuum (PG 13+)
	VacuumProgressByteCols  bool // pg_stat_progress_vacuum's byte-based columns (PG 17+)

	// QueryMetrics is true when gp_enable_query_metrics is on AND
	// whpg_plan_tree.instrument_detail exists — i.e. the whpg_plan_tree
	// extension is installed in this database. The GUC is PGC_POSTMASTER
	// (needs a cluster restart), so it's an operator action; the view
	// comes for free with CREATE EXTENSION whpg_plan_tree (no separate
	// bootstrap DDL any more).
	QueryMetrics bool
	// SessionMemoryStats is true when the gp_internal_tools extension is
	// installed (session_state.session_level_memory_consumption view).
	SessionMemoryStats bool

	// RealPlanShmem is true when the connected server has the whpg_plan_tree
	// extension installed (CREATE EXTENSION whpg_plan_tree; zero core
	// changes required — portable across WHPG7/GPDB7, Cloudberry, and
	// WHPG19-next; see ~/work/whpg_plan_tree). When true, the watch
	// endpoint can build the plan-node tree from
	// whpg_plan_tree.plan_detail (real plan_node_id, real parent/child,
	// no re-EXPLAIN, no client-side node-numbering). When false, the
	// live query plan tree feature is hidden entirely rather than
	// falling back to an EXPLAIN-based reconstruction — see
	// handler/instrumentation.go.
	RealPlanShmem bool
}

// probedTables is every catalog view this codebase relies on a
// version/fork-sensitive column of. Kept in one place so detectCapabilities
// only ever needs one round trip.
var probedTables = []string{
	"pg_stat_activity", "pg_stat_database", "pg_stat_checkpointer",
	"pg_replication_slots", "pg_stat_wal", "pg_stat_user_tables",
	"pg_stat_progress_vacuum",
}

// detectCapabilities probes information_schema.columns once for every
// version/fork-sensitive column this codebase relies on, so query.go/handler
// code can pick a compatible SQL variant instead of guessing from a version
// number and hitting "column does not exist" on whatever server it's wrong
// for.
func detectCapabilities(ctx context.Context, pool *pgxpool.Pool) (*Capabilities, error) {
	rows, err := pool.Query(ctx, `
		SELECT table_name, column_name
		FROM information_schema.columns
		WHERE table_schema = 'pg_catalog' AND table_name = ANY($1)
	`, probedTables)
	if err != nil {
		return nil, fmt.Errorf("detectCapabilities: %w", err)
	}
	defer rows.Close()

	has := make(map[string]bool)
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			return nil, fmt.Errorf("detectCapabilities: %w", err)
		}
		has[table+"."+column] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("detectCapabilities: %w", err)
	}

	caps := &Capabilities{
		ActivityQueryID:         has["pg_stat_activity.query_id"],
		DatabaseSessionStats:    has["pg_stat_database.session_time"],
		StatCheckpointer:        has["pg_stat_checkpointer.num_timed"],
		ReplicationSlotInactive: has["pg_replication_slots.inactive_since"],
		StatWAL:                 has["pg_stat_wal.wal_records"],
		TableInsertsSinceVacuum: has["pg_stat_user_tables.n_ins_since_vacuum"],
		VacuumProgressByteCols:  has["pg_stat_progress_vacuum.max_dead_tuple_bytes"],
	}
	switch {
	case has["pg_stat_wal.wal_fpi"]:
		caps.StatWALFPIColumn = "wal_fpi"
	case has["pg_stat_wal.wal_fpw"]:
		caps.StatWALFPIColumn = "wal_fpw"
	}

	var queryMetricsGUCOn, instrumentViewExists, memoryViewExists, planShmemViewExists bool
	err = pool.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT setting = 'on' FROM pg_settings WHERE name = 'gp_enable_query_metrics'), false),
			to_regclass('whpg_plan_tree.instrument_detail') IS NOT NULL,
			to_regclass('session_state.session_level_memory_consumption') IS NOT NULL,
			to_regclass('whpg_plan_tree.plan_detail') IS NOT NULL
	`).Scan(&queryMetricsGUCOn, &instrumentViewExists, &memoryViewExists, &planShmemViewExists)
	if err != nil {
		return nil, fmt.Errorf("detectCapabilities: %w", err)
	}
	caps.QueryMetrics = queryMetricsGUCOn && instrumentViewExists
	caps.SessionMemoryStats = memoryViewExists
	caps.RealPlanShmem = queryMetricsGUCOn && planShmemViewExists

	return caps, nil
}

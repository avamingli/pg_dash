package query

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		// Skip all tests if no PG_DSN
		os.Exit(0)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var err error
	testPool, err = pgxpool.New(ctx, dsn)
	if err != nil {
		panic("failed to connect: " + err.Error())
	}
	defer testPool.Close()

	os.Exit(m.Run())
}

func queryOK(t *testing.T, sql string, args ...interface{}) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := testPool.Query(ctx, sql, args...)
	if err != nil {
		t.Fatalf("query failed: %v\nSQL: %s", err, sql)
	}
	defer rows.Close()

	// Consume all rows to verify the full result set parses
	count := 0
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			t.Fatalf("row scan failed on row %d: %v", count, err)
		}
		_ = vals
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows iteration error: %v", err)
	}
	t.Logf("OK — %d rows returned", count)
}

// --- server.go ---

func TestServerVersion(t *testing.T) {
	queryOK(t, ServerVersion)
}

func TestServerVersionNum(t *testing.T) {
	queryOK(t, ServerVersionNum)
}

func TestServerUptime(t *testing.T) {
	queryOK(t, ServerUptime)
}

func TestServerSettings(t *testing.T) {
	queryOK(t, ServerSettings)
}

func TestServerPGConfig(t *testing.T) {
	queryOK(t, ServerPGConfig)
}

func TestMaxConnections(t *testing.T) {
	queryOK(t, MaxConnections)
}

// --- activity.go ---

func TestActiveConnections(t *testing.T) {
	queryOK(t, ActiveConnections)
}

func TestConnectionCountsByState(t *testing.T) {
	queryOK(t, ConnectionCountsByState)
}

func TestConnectionCountsByDatabase(t *testing.T) {
	queryOK(t, ConnectionCountsByDatabase)
}

func TestConnectionCountsByUser(t *testing.T) {
	queryOK(t, ConnectionCountsByUser)
}

func TestLongRunningQueries(t *testing.T) {
	queryOK(t, LongRunningQueries, "5 seconds")
}

func TestBlockedQueries(t *testing.T) {
	queryOK(t, BlockedQueries)
}

func TestIdleInTransaction(t *testing.T) {
	queryOK(t, IdleInTransaction, "30 seconds")
}

func TestCancelBackend(t *testing.T) {
	// Use PID 0 which won't match any real backend — safe no-op
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var result bool
	err := testPool.QueryRow(ctx, CancelBackend, 0).Scan(&result)
	if err != nil {
		t.Fatalf("CancelBackend query failed: %v", err)
	}
	t.Logf("OK — pg_cancel_backend(0) = %v", result)
}

func TestTerminateBackend(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var result bool
	err := testPool.QueryRow(ctx, TerminateBackend, 0).Scan(&result)
	if err != nil {
		t.Fatalf("TerminateBackend query failed: %v", err)
	}
	t.Logf("OK — pg_terminate_backend(0) = %v", result)
}

// --- database.go ---

func TestDatabaseList(t *testing.T) {
	queryOK(t, DatabaseList)
}

func TestDatabaseSizes(t *testing.T) {
	queryOK(t, DatabaseSizes)
}

func TestDatabaseSizeTotal(t *testing.T) {
	queryOK(t, DatabaseSizeTotal)
}

func TestDatabaseTPS(t *testing.T) {
	queryOK(t, DatabaseTPS)
}

func TestDatabaseCacheHitRatio(t *testing.T) {
	queryOK(t, DatabaseCacheHitRatio)
}

// --- table.go ---

func TestTableList(t *testing.T) {
	queryOK(t, TableList, "%")
}

func TestTableBloat(t *testing.T) {
	queryOK(t, TableBloat)
}

func TestTableIOStats(t *testing.T) {
	// Use a schema/table that is unlikely to exist — should return 0 rows, no error
	queryOK(t, TableIOStats, "public", "__nonexistent_table__")
}

func TestTableIOStatsAll(t *testing.T) {
	queryOK(t, TableIOStatsAll)
}

// --- index.go ---

func TestIndexList(t *testing.T) {
	queryOK(t, IndexList)
}

func TestUnusedIndexes(t *testing.T) {
	queryOK(t, UnusedIndexes)
}

func TestDuplicateIndexes(t *testing.T) {
	queryOK(t, DuplicateIndexes)
}

func TestIndexBloat(t *testing.T) {
	queryOK(t, IndexBloat)
}

func TestIndexesForTable(t *testing.T) {
	queryOK(t, IndexesForTable, "public", "__nonexistent_table__")
}

// --- locks.go ---

func TestCurrentLocks(t *testing.T) {
	queryOK(t, CurrentLocks)
}

func TestLockConflicts(t *testing.T) {
	queryOK(t, LockConflicts)
}

func TestBlockingChains(t *testing.T) {
	queryOK(t, BlockingChains)
}

func TestLockTypeSummary(t *testing.T) {
	queryOK(t, LockTypeSummary)
}

// --- replication.go ---

func TestReplicationStatus(t *testing.T) {
	queryOK(t, ReplicationStatus)
}

func TestReplicationSlots(t *testing.T) {
	queryOK(t, ReplicationSlots)
}

func TestWALStats(t *testing.T) {
	queryOK(t, WALStats)
}

func TestCurrentWALLSN(t *testing.T) {
	queryOK(t, CurrentWALLSN)
}

func TestWALIsRecovery(t *testing.T) {
	queryOK(t, WALIsRecovery)
}

// --- statements.go ---

func TestStatementsAvailable(t *testing.T) {
	queryOK(t, StatementsAvailable)
}

func TestTopQuerysByTotalTime(t *testing.T) {
	// Check if pg_stat_statements is installed first
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var available bool
	if err := testPool.QueryRow(ctx, StatementsAvailable).Scan(&available); err != nil {
		t.Fatalf("StatementsAvailable query failed: %v", err)
	}
	if !available {
		t.Skip("pg_stat_statements extension not installed")
	}
	queryOK(t, TopQuerysByTotalTime, 10)
}

func TestTopQuerysByCalls(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var available bool
	if err := testPool.QueryRow(ctx, StatementsAvailable).Scan(&available); err != nil {
		t.Fatalf("StatementsAvailable query failed: %v", err)
	}
	if !available {
		t.Skip("pg_stat_statements extension not installed")
	}
	queryOK(t, TopQuerysByCalls, 10)
}

func TestTopQuerysByRows(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var available bool
	if err := testPool.QueryRow(ctx, StatementsAvailable).Scan(&available); err != nil {
		t.Fatalf("StatementsAvailable query failed: %v", err)
	}
	if !available {
		t.Skip("pg_stat_statements extension not installed")
	}
	queryOK(t, TopQuerysByRows, 10)
}

func TestTopQuerysByTemp(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var available bool
	if err := testPool.QueryRow(ctx, StatementsAvailable).Scan(&available); err != nil {
		t.Fatalf("StatementsAvailable query failed: %v", err)
	}
	if !available {
		t.Skip("pg_stat_statements extension not installed")
	}
	queryOK(t, TopQuerysByTemp, 10)
}

// --- vacuum.go ---

func TestVacuumProgress(t *testing.T) {
	queryOK(t, VacuumProgress)
}

func TestAutovacuumWorkers(t *testing.T) {
	queryOK(t, AutovacuumWorkers)
}

func TestTablesNeedingVacuum(t *testing.T) {
	queryOK(t, TablesNeedingVacuum)
}

func TestAutovacuumSettings(t *testing.T) {
	queryOK(t, AutovacuumSettings)
}

// --- checkpoint.go ---

func TestCheckpointStats(t *testing.T) {
	queryOK(t, CheckpointStats)
}

func TestBGWriterStats(t *testing.T) {
	queryOK(t, BGWriterStats)
}

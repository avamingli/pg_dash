package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/alert"
	"github.com/avamingli/dbhouse-web/backend/internal/config"
	"github.com/avamingli/dbhouse-web/backend/internal/monitor"
	osmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/os"
	pgmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/pg"
	"github.com/avamingli/dbhouse-web/backend/internal/ws"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		dsn = "postgres://gpadmin@127.0.0.1:17000/postgres"
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		// Skip tests if PG is not available
		os.Exit(0)
	}
	if err := pool.Ping(context.Background()); err != nil {
		os.Exit(0)
	}
	testPool = pool
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

func setupRouter(pool *pgxpool.Pool) chi.Router {
	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		RegisterServerRoutes(r, pool)
		RegisterActivityRoutes(r, pool)
		RegisterDatabaseRoutes(r, pool)
		RegisterIndexRoutes(r, pool)
		RegisterQueryRoutes(r, pool)
		RegisterLockRoutes(r, pool)
		RegisterReplicationRoutes(r, pool)
		RegisterVacuumRoutes(r, pool)
		RegisterCheckpointRoutes(r, pool)
	})
	return r
}

func doGet(t *testing.T, r chi.Router, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ── Server Routes ──

func TestServerInfoHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/server/info")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["version"] == nil {
		t.Error("missing version field")
	}
	if result["max_connections"] == nil {
		t.Error("missing max_connections field")
	}
}

func TestServerConfigHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/server/config")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) < 100 {
		t.Errorf("expected many pg_settings, got %d", len(result))
	}
}

// ── Activity Routes ──

func TestActivityHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/activity")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestActivitySummaryHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/activity/summary")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["by_state"] == nil {
		t.Error("missing by_state field")
	}
}

func TestLongRunningHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/activity/long-running?threshold=5+seconds")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestBlockedHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/activity/blocked")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Database Routes ──

func TestDatabasesHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/databases")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) == 0 {
		t.Error("expected at least 1 database")
	}
}

func TestDatabaseTablesHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/databases/postgres/tables")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Index Routes ──

func TestIndexesHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/indexes")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUnusedIndexesHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/indexes/unused")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Lock Routes ──

func TestLocksHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/locks")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["locks"] == nil {
		t.Error("missing locks field")
	}
}

func TestLockConflictsHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/locks/conflicts")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Replication Routes ──

func TestReplicationStatusHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/replication/status")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestReplicationSlotsHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/replication/slots")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWALStatsHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/replication/wal")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Vacuum Routes ──

func TestVacuumProgressHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/vacuum/progress")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVacuumWorkersHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/vacuum/workers")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVacuumNeededHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/vacuum/needed")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Checkpoint Routes ──

func TestCheckpointStatsHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/checkpoint/stats")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Query Routes ──

func TestTopQueriesHandler(t *testing.T) {
	r := setupRouter(testPool)
	w := doGet(t, r, "/api/queries/top?by=time&limit=5")
	// May return 503/500 if pg_stat_statements not installed, that's OK
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable && w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200, 503, or 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestExecuteQueryHandler(t *testing.T) {
	r := setupRouter(testPool)
	body := `{"sql":"SELECT 1 AS val","read_only":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/query/execute", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["rows"] == nil {
		t.Error("missing rows field")
	}
}

func TestExplainQueryHandler(t *testing.T) {
	r := setupRouter(testPool)
	body := `{"sql":"SELECT 1","analyze":false,"buffers":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/query/explain", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Alert Routes ──

func TestAlertHandlers(t *testing.T) {
	engine := alert.NewEngine(nil)
	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		RegisterAlertRoutes(r, engine)
	})

	// Get all alerts
	w := doGet(t, r, "/api/alerts")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Get active alerts
	w = doGet(t, r, "/api/alerts/active")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Get alert count
	w = doGet(t, r, "/api/alerts/count")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var result map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result["count"] == nil {
		t.Error("missing count field")
	}
}

// ── Metrics Routes ──

func TestMetricsHandlers(t *testing.T) {
	pgdata := os.Getenv("PGDATA")
	if pgdata == "" {
		pgdata = "/home/gpadmin/dbhouse/pg17"
	}

	pgCollector := pgmon.NewCollector(testPool)
	osCollector := osmon.NewSystemCollectorWithPGData(pgdata)
	hub := ws.NewHub()
	go hub.Run()
	agg := monitor.NewAggregator(pgCollector, osCollector, hub, nil)
	agg.Start(context.Background())
	defer agg.Stop()

	// Wait for at least one collection
	time.Sleep(3 * time.Second)

	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		RegisterMetricsRoutes(r, agg)
		RegisterSystemRoutes(r, agg)
	})

	// Latest metrics
	w := doGet(t, r, "/api/metrics/latest")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// History
	w = doGet(t, r, "/api/metrics/history?duration=10s")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// System endpoints
	for _, path := range []string{
		"/api/system/cpu",
		"/api/system/memory",
		"/api/system/disk",
		"/api/system/disk/io",
		"/api/system/network",
		"/api/system/processes",
	} {
		w = doGet(t, r, path)
		if w.Code != http.StatusOK {
			t.Errorf("%s: expected 200, got %d: %s", path, w.Code, w.Body.String())
		}
	}
}

// ── Auth Routes ──

func TestLoginHandler_Success(t *testing.T) {
	cfg := &config.Config{
		AdminUser:     "admin",
		AdminPassword: "testpass",
		JWTSecret:     "test-secret",
	}

	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		RegisterAuthRoutes(r, cfg)
	})

	body := `{"username":"admin","password":"testpass"}`
	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result["token"] == nil || result["token"] == "" {
		t.Error("missing token in response")
	}
	if result["expires_at"] == nil {
		t.Error("missing expires_at in response")
	}
}

func TestLoginHandler_BadPassword(t *testing.T) {
	cfg := &config.Config{
		AdminUser:     "admin",
		AdminPassword: "testpass",
		JWTSecret:     "test-secret",
	}

	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		RegisterAuthRoutes(r, cfg)
	})

	body := `{"username":"admin","password":"wrong"}`
	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLoginHandler_BadUsername(t *testing.T) {
	cfg := &config.Config{
		AdminUser:     "admin",
		AdminPassword: "testpass",
		JWTSecret:     "test-secret",
	}

	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		RegisterAuthRoutes(r, cfg)
	})

	body := `{"username":"wrong","password":"testpass"}`
	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}


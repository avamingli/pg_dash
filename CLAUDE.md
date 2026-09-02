# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PG Dash — a PostgreSQL/MPP (Apache Cloudberry, Greenplum) monitoring dashboard. Go backend + React frontend. Connects to an existing external PostgreSQL instance via `PG_DSN`; auto-detects distributed clusters and exposes extra MPP-only pages/endpoints when connected to one.

**The real backend module lives at `backend/` (module `github.com/avamingli/dbhouse-web/backend`), with its own `go.mod`.** The root-level `main.go` / `go.mod` (module `dbhouse-web`, a bare `gin` "ping" server) is leftover scaffold cruft, not part of the running app — don't confuse it with `backend/cmd/server/main.go`, which is the actual entry point.

## Commands

Run from repo root unless noted. Config is loaded from `.env` (copy from `.env.example`; requires `PG_DSN`).

- `make dev` — build backend, then run backend + frontend dev server together (Ctrl+C stops both)
- `make dev-backend` / `make dev-frontend` — run one side only
- `make build` — production backend binary + frontend bundle
- `make test` — backend unit tests (`cd backend && go test ./internal/... -count=1 -timeout 60s`)
- `make test-integration` — backend tests requiring a real PG connection (`-tags=integration`)
- `make test-frontend` — `cd frontend && npm test` (Vitest)
- `make stop` — kill any running dashboard processes by pattern-match
- `make docker-build` / `docker-up` / `docker-down` — dev Docker Compose (backend 4000, frontend 3000)
- `make docker-prod-up` / `docker-prod-down` — prod Compose (nginx on 80, proxies `/api` → backend)

Single test, backend: `cd backend && go test ./internal/monitor/... -run TestAggregator -v`
Single test, frontend: `cd frontend && npx vitest run src/lib/api.test.ts`

Two categories of Go tests exist:
- Plain unit tests — run anywhere, no PG needed.
- Tests gated on `PG_DSN` (e.g. `backend/internal/query/query_test.go` execs every SQL constant against a live connection to catch syntax errors) or on `-tags=integration` — these `os.Exit(0)`/skip cleanly when the env var/tag is absent, so `make test` alone won't catch a broken query string. Set `PG_DSN` and run `make test-integration` (or `go test ./internal/query/...`) before trusting SQL changes.

Frontend lint: `cd frontend && npm run lint` (eslint). Frontend build type-checks via `tsc -b` as part of `npm run build`.

## Architecture

```
React (Vite/TS, :3000, proxies /api and /ws to backend)
  → REST + WebSocket
Go backend (chi router, :4001 default)
  ConnectionManager (pgxpool)  →  Aggregator (2s tick)  →  ws.Hub (broadcast)
        │                              │
   detects PG vs Cloudberry/Greenplum  ├─ PG collector (monitor/pg)
   via SELECT version() +              ├─ OS collector (monitor/os, gopsutil)
   gp_segment_configuration            ├─ Log collector (PG log FATAL/ERROR/WARNING)
                                        └─ Cluster collector (only if distributed)
  Ring buffer (300 entries = 10 min @ 2s) → GetHistory()/GetLatest()
  SQLite-backed SnapshotStore (5-min snapshots, 7-day retention, ~/.pg-dash/snapshots)
  Alert engine (rule eval against each snapshot, broadcasts via same hub)
```

Backend layers, each with one job (`backend/internal/`):
- `query/` — every SQL statement as a raw Go string constant (no ORM, no query builder). One file per PG subsystem (`activity.go`, `database.go`, `locks.go`, `replication.go`, `cluster.go`, …). Parameterize with `$1`, `$2` for pgx.
- `model/` — response structs with `json` tags that must match `frontend/src/types/metrics.ts` field-for-field.
- `monitor/pg/` — `Collector` (core PG stats), `LogCollector` (tails PG log for FATAL/ERROR/WARNING counts), `ClusterCollector` (MPP-only: segment topology, per-segment replication).
- `monitor/os/` — `SystemCollector` (gopsutil: CPU/mem/disk/net/processes) + `DeltaCalculator` (turns cumulative counters into per-second rates for disk/network I/O).
- `monitor/aggregator.go` — ties PG + OS + cluster + log collectors together on one 2s ticker, owns the ring buffer, feeds the alert engine and the WebSocket hub.
- `service/` — `ConnectionManager` (pool lifecycle, cluster-mode detection, per-database pool cache, reconnect w/ exponential backoff), `SnapshotStore`, `HistoryService` (query history tracking).
- `ws/` — `Hub`/`Client`, broadcasts every aggregator tick to all connected browsers.
- `alert/` — rule engine; evaluated against each snapshot inside the aggregator loop.
- `recommend/` — one-shot health scanner (bloat, missing indexes, vacuum debt, config drift) that returns actionable SQL fixes; queried on demand by the Recommendations page, not on the aggregator tick.
- `middleware/` — optional JWT auth (`middleware/auth.go`) plus request logging; auth middleware only mounts when `Config.AuthEnabled()` is true.
- `handler/` — one file per REST resource; each exposes a `Register*Routes(r chi.Router, …)` called from `cmd/server/main.go`. Routes for MPP-only features (`RegisterClusterRoutes`) are only mounted when `clusterInfo.IsDistributed()`.

Cluster-mode detection (`service/connection.go`): `TestConnection` runs `SELECT version()`, matches for `Apache Cloudberry` / `Greenplum Database` in the string, then queries `gp_segment_configuration` for segment/mirror counts and `gp_resource_manager`. Plain PostgreSQL short-circuits to `ModePostgreSQL`. `ClusterInfo.IsDistributed()` is the single gate used everywhere (main.go wiring, handler registration, frontend nav) to decide whether MPP UI/endpoints appear.

Frontend (`frontend/src/`):
- `pages/` — one page per sidebar entry; MPP-only page is `Cluster.tsx`.
- `contexts/` — `MetricsContext` (subscribes to the WebSocket snapshot stream, feeds all pages), `AuthContext` (optional JWT auth, only active when `ADMIN_USER`/`ADMIN_PASSWORD` are set).
- `lib/api.ts` — single typed REST client; every backend endpoint has one method here, keyed to `types/metrics.ts`.
- `hooks/useWebSocket.ts` — WebSocket connection with reconnect; `hooks/useFetch.ts` — generic fetch hook.
- Vite dev server proxies `/api` and `/ws` to `http://localhost:$BACKEND_PORT` (`vite.config.ts`); `BACKEND_PORT`/`FRONTEND_PORT` come from the root `.env` via `make dev`.

## Conventions

- All PG queries are raw SQL string constants in `query/`, one per file matching the PG subsystem, each with a doc comment explaining what it does. Use pgx/v5 `QueryRow`/`Query`/`Exec` directly — no ORM.
- Go errors: wrap with `fmt.Errorf("FunctionName: %w", err)`.
- Model structs' `json` tags must stay in sync with the corresponding TS interface in `frontend/src/types/metrics.ts` — check both sides when changing an API response shape.
- Auth is fully optional: `Config.AuthEnabled()` is true only when both `ADMIN_USER` and `ADMIN_PASSWORD` are set; don't assume auth middleware always runs.
- Adding an endpoint touches, in order: `query/` (SQL) → `model/` (struct) → `handler/` (Register func + route) → `cmd/server/main.go` (wire the Register call) → `frontend/src/types/metrics.ts` → `frontend/src/lib/api.ts`.

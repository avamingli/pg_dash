# Building a PostgreSQL Dashboard from Zero with Claude Code

**Go Backend + React Frontend — Full System & Database Monitoring**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  (Vite + TypeScript + Tailwind + shadcn/ui + Recharts)  │
│         http://localhost:3000                            │
└───────────────┬──────────────────┬──────────────────────┘
                │ REST API          │ WebSocket
                ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                   Go Backend                             │
│  (Gin/Chi + pgx + gorilla/websocket + gopsutil)         │
│         http://localhost:4000                            │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  PG Monitor  │  │  OS Monitor  │  │  Alert Engine │  │
│  │  (pgx pool)  │  │  (gopsutil)  │  │  (rules eval) │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────┘  │
│         │                 │                              │
│         ▼                 ▼                              │
│  ┌──────────────────────────────┐                        │
│  │  Metrics Collector (2s tick) │──→ WebSocket broadcast │
│  │  + Rolling buffer (10 min)  │──→ Snapshot store       │
│  └──────────────────────────────┘                        │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│           Your PostgreSQL Instance                       │
│  (existing, prepared — connect via connection string)    │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Backend** | Go 1.22+ | Your language, great concurrency for metric
collection |
| **HTTP Router** | `chi` or `gin` | Lightweight, middleware-friendly |
| **PG Driver** | `pgx/v5` | Best Go PG driver, supports COPY,
LISTEN/NOTIFY, pgtype |
| **System Metrics** | `gopsutil/v4` | Cross-platform
CPU/memory/disk/net/process stats |
| **WebSocket** | `gorilla/websocket` | Mature, battle-tested |
| **Config** | `viper` | Env vars + config file |
| **Frontend** | React 19 + Vite + TypeScript | Fast dev, rich ecosystem
|
| **UI** | shadcn/ui + Tailwind CSS | Professional, themeable |
| **Charts** | Recharts | React-native charts, good for real-time |
| **Containerization** | Docker + docker-compose | Dev environment only
(PG is external) |

---

## Phase 0: Project Bootstrap (Day 1)

### 0.1 Prompt: Scaffold the Project

```
claude "Create a project called pg-dashboard with this structure:

pg-dashboard/
├── backend/                    # Go module: github.com/zml/pg-dashboard
│   ├── cmd/server/main.go      # Entry point
│   ├── internal/
│   │   ├── config/             # Viper config loading
│   │   ├── handler/            # HTTP handlers
│   │   ├── middleware/         # Auth, CORS, logging
│   │   ├── model/              # Struct types for API responses
│   │   ├── monitor/
│   │   │   ├── pg/             # PostgreSQL metric collectors
│   │   │   └── os/             # OS-level metric collectors (gopsutil)
│   │   ├── query/              # Raw SQL query strings as constants
│   │   ├── service/            # Business logic layer
│   │   ├── ws/                 # WebSocket hub and client management
│   │   └── alert/              # Alert rules engine
│   ├── go.mod
│   ├── go.sum
│   └── Makefile
├── frontend/                   # React + Vite + TypeScript
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Dashboard pages
│   │   ├── hooks/              # Custom React hooks (useWebSocket,
useFetch)
│   │   ├── types/              # TypeScript interfaces matching Go
models
│   │   ├── lib/                # API client, utils
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── docker-compose.yml      # Backend + frontend only (PG is
external)
├── .claude/
│   ├── settings.json
│   └── commands/
├── CLAUDE.md
└── README.md

Go dependencies: chi, pgx/v5, gorilla/websocket, gopsutil/v4, viper,
zerolog.
Frontend dependencies: React 19, Vite, TypeScript, Tailwind, shadcn/ui,
recharts,
  reconnecting-websocket.

The docker-compose should run backend (port 4000) and frontend (port
3000).
PostgreSQL is external — connection string comes from environment
variable
PG_DSN=postgres://user:pass@host:5432/dbname.
Backend Makefile targets: build, run, dev (with air for hot reload),
test."
```

### 0.2 Write CLAUDE.md

```markdown
# CLAUDE.md — pg-dashboard

## Project
PostgreSQL monitoring dashboard. Go backend + React frontend.
Connects to an existing external PostgreSQL instance.

## Stack
- Backend: Go 1.22+ / chi router / pgx v5 / gopsutil v4 /
  gorilla/websocket / zerolog
- Frontend: React 19 / Vite / TypeScript / Tailwind / shadcn/ui /
  recharts
- PG is external. Connection via PG_DSN env var.

## Commands
- cd backend && make dev          — backend with hot reload (port 4000)
- cd frontend && npm run dev      — frontend dev server (port 3000)
- cd backend && make test         — run Go tests
- cd backend && make build        — production binary

## Architecture
- backend/internal/query/         — all raw SQL as Go string constants
- backend/internal/monitor/pg/    — PG metric collectors (goroutines)
- backend/internal/monitor/os/    — OS metric collectors via gopsutil
- backend/internal/ws/            — WebSocket hub, broadcasts every 2s
- backend/internal/handler/       — HTTP handlers, one file per resource
- frontend/src/pages/             — one page per dashboard tab

## Conventions
- All PG queries are raw SQL string constants in query/ package. No ORM.
- Use pgx/v5 directly with QueryRow/Query/Exec.
- Structs in model/ must have json tags matching frontend TypeScript
  types.
- Go errors: wrap with fmt.Errorf("functionName: %w", err)
- Frontend: all API calls through lib/api.ts client.
```

### 0.3 Configure Claude Code

```json
// .claude/settings.json
{
  "permissions": {
    "allow": [
      "Bash(go *)", "Bash(make *)", "Bash(npm *)", "Bash(npx *)",
      "Bash(docker *)", "Bash(docker-compose *)",
      "Bash(psql *)", "Bash(curl *)",
      "Bash(git *)", "Bash(cat *)", "Bash(ls *)", "Bash(mkdir *)",
      "Bash(grep *)", "Bash(find *)", "Bash(sed *)",
      "Read(*)", "Write(*)", "Edit(*)"
    ]
  }
}
```

---

## Phase 1: Go Backend — Core Infrastructure (Days 2–3)

### 1.1 Prompt: PG Connection Manager

```
claude "Create backend/internal/service/connection.go:

A ConnectionManager that:
- Connects to PostgreSQL using pgx/v5 pool (pgxpool.Pool)
- Reads PG_DSN from config (viper)
- Pool config: max conns 10, min conns 2, health check period 30s
- TestConnection() — runs SELECT 1 and returns version string
- GetPool() — returns the *pgxpool.Pool
- Close() — graceful shutdown
- Reconnect logic with exponential backoff

Also create backend/internal/service/connection_test.go with
integration test using a real PG connection (skip if PG_DSN not set)."
```

### 1.2 Prompt: SQL Query Library

```
claude "Create backend/internal/query/ with these files.
Each file has Go string constants for raw SQL. No ORM, no query builder.
Parameterize with $1, $2 etc for pgx.

query/server.go:
- ServerVersion — SELECT version()
- ServerUptime — pg_postmaster_start_time based
- ServerSettings — key settings from pg_settings (shared_buffers,
  work_mem,
  effective_cache_size, max_connections, max_wal_size,
checkpoint_completion_target,
  random_page_cost, effective_io_concurrency, max_worker_processes,
  max_parallel_workers_per_gather, wal_level, archive_mode)
- ServerPGConfig — full pg_settings with name, setting, unit, category,
  short_desc, source, boot_val, reset_val, pending_restart

query/activity.go:
- ActiveConnections — pg_stat_activity with pid, usename, datname,
  client_addr, client_port, backend_start, xact_start, query_start,
  state_change, wait_event_type, wait_event, state, backend_type, query
- ConnectionCountsByState — GROUP BY state
- ConnectionCountsByDatabase — GROUP BY datname
- ConnectionCountsByUser — GROUP BY usename
- LongRunningQueries — active queries running longer than $1 interval
- BlockedQueries — queries waiting on locks
- IdleInTransaction — idle in transaction longer than $1 interval

query/database.go:
- DatabaseList — pg_database join pg_stat_database:
  datname, pg_database_size(), numbackends, xact_commit, xact_rollback,
  blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted,
  tup_updated, tup_deleted, conflicts, temp_files, temp_bytes,
deadlocks,
  blk_read_time, blk_write_time, stats_reset,
  cache_hit_ratio = blks_hit / (blks_hit + blks_read)
- DatabaseSizes — all databases with sizes, sorted by size desc

query/table.go:
- TableList — for a given database via $1 schema filter:
  pg_stat_user_tables join pg_class for sizes.
  schemaname, relname, pg_total_relation_size, pg_relation_size,
  pg_indexes_size, n_live_tup, n_dead_tup,
  dead_tuple_ratio = n_dead_tup::float / NULLIF(n_live_tup + n_dead_tup,
0),
  seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
  n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd,
  last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
  vacuum_count, autovacuum_count, analyze_count, autoanalyze_count
- TableBloat — estimated bloat using pgstattuple or statistical method
- TableIOStats — pg_statio_user_tables: heap_blks_read, heap_blks_hit,
  idx_blks_read, idx_blks_hit, toast_blks_read, toast_blks_hit

query/index.go:
- IndexList — pg_stat_user_indexes join pg_class:
  schemaname, relname, indexrelname, pg_relation_size(indexrelid),
  idx_scan, idx_tup_read, idx_tup_fetch
- UnusedIndexes — indexes with idx_scan = 0 since stats reset
- DuplicateIndexes — indexes on same table with same column set
  (use pg_index.indkey comparison)
- IndexBloat — estimated index bloat

query/locks.go:
- CurrentLocks — pg_locks with relation names resolved
- LockConflicts — blocking_pid, blocked_pid, blocking_query,
  blocked_query
  using pg_blocking_pids() function
- BlockingChains — recursive CTE to show full blocking trees

query/replication.go:
- ReplicationStatus — pg_stat_replication: pid, usename,
  application_name,
  client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
  write_lag, flush_lag, replay_lag, sync_state, sync_priority
- ReplicationSlots — pg_replication_slots: slot_name, slot_type, active,
  restart_lsn, confirmed_flush_lsn, wal_status
- WALStats — pg_stat_wal: wal_records, wal_fpi, wal_bytes, wal_write,
  wal_sync, wal_write_time, wal_sync_time, stats_reset

query/statements.go:
- TopQuerysByTotalTime — pg_stat_statements ORDER BY total_exec_time
  LIMIT $1. Include queryid, query, calls, total_exec_time,
mean_exec_time,
  min_exec_time, max_exec_time, stddev_exec_time, rows,
  shared_blks_hit, shared_blks_read, local_blks_hit, local_blks_read,
  temp_blks_read, temp_blks_written, blk_read_time, blk_write_time,
  wal_records, wal_fpi, wal_bytes
- TopQuerysByCalls — same but ORDER BY calls
- TopQuerysByRows — ORDER BY rows
- StatementsReset — SELECT pg_stat_statements_reset()

query/vacuum.go:
- VacuumProgress — pg_stat_progress_vacuum
- AutovacuumWorkers — pg_stat_activity WHERE backend_type = 'autovacuum
  worker'
- TablesNeedingVacuum — tables with high dead tuple ratio or long since
  vacuum

query/checkpoint.go:
- CheckpointStats — pg_stat_bgwriter: checkpoints_timed,
  checkpoints_req,
  checkpoint_write_time, checkpoint_sync_time, buffers_checkpoint,
  buffers_clean, maxwritten_clean, buffers_backend,
buffers_backend_fsync,
  buffers_alloc

Each query must have a comment explaining what it does."
```

### 1.3 Prompt: OS-Level System Monitor

```
claude "Create backend/internal/monitor/os/collector.go using
gopsutil/v4:

A SystemCollector struct with methods that return typed structs:

CPUStats():
- Overall CPU usage percent (user, system, idle, iowait, steal)
- Per-core CPU usage percent
- Load average (1, 5, 15 min)
- Number of CPUs

MemoryStats():
- Total, used, available, free, cached, buffers, swap total/used/free
- Usage percentages

DiskStats():
- Per-mount-point: total, used, free, usage percent, fstype, mount point
- Focus on the mount point where PG data directory lives ($PGDATA or
  detected)

DiskIOStats():
- Per-device: read_count, write_count, read_bytes, write_bytes,
  read_time, write_time, iops_in_progress, io_time, weighted_io_time
- Calculate deltas between collections for rate (reads/s, writes/s,
  MB/s)

NetworkStats():
- Per-interface: bytes_sent, bytes_recv, packets_sent, packets_recv,
  errin, errout, dropin, dropout
- Calculate deltas for rate

ProcessStats():
- Find PostgreSQL processes by name (postgres, postmaster)
- For each: pid, cpu_percent, memory_percent, memory_rss, status,
  cmdline, num_fds, num_threads
- Identify: postmaster, checkpointer, bgwriter, walwriter, autovacuum
  launcher,
  stats collector, logical replication, WAL sender/receiver, backends

All collectors should be safe for concurrent access.
Include a DeltaCalculator that stores previous values and computes
per-second rates for counters."
```

### 1.4 Prompt: Metric Aggregator & WebSocket Hub

```
claude "Create backend/internal/monitor/aggregator.go:

An Aggregator that runs as a goroutine:
- Ticks every 2 seconds
- Calls PG monitor and OS monitor collectors
- Produces a MetricsSnapshot struct combining all metrics with timestamp
- Stores snapshots in a ring buffer (last 10 minutes = 300 entries)
- Sends snapshot to WebSocket hub for broadcast
- Exposes GetHistory(duration) for sparkline data

Create backend/internal/ws/hub.go:
- WebSocket hub pattern (from gorilla/websocket examples)
- Clients connect to /ws
- Hub broadcasts MetricsSnapshot JSON to all connected clients
- Support subscription filters (e.g., client only wants OS metrics)
- Handle client disconnect gracefully
- Ping/pong keepalive every 30 seconds"
```

### 1.5 Prompt: HTTP Handlers & Router

```
claude "Create the REST API handlers and router.

backend/internal/handler/server.go:
  GET /api/server/info          — version, uptime, key settings
  GET /api/server/config        — full pg_settings

backend/internal/handler/activity.go:
  GET /api/activity              — all connections from pg_stat_activity
  GET /api/activity/summary      — counts by state, database, user
  GET /api/activity/long-running?threshold=5s
  GET /api/activity/blocked
  POST /api/activity/:pid/cancel    — pg_cancel_backend
  POST /api/activity/:pid/terminate — pg_terminate_backend

backend/internal/handler/database.go:
  GET /api/databases             — list with stats and sizes
  GET /api/databases/:name/tables
  GET /api/databases/:name/tables/:table/io
  GET /api/databases/:name/indexes

backend/internal/handler/index.go:
  GET /api/indexes               — all indexes for current database
  GET /api/indexes/unused
  GET /api/indexes/duplicate
  GET /api/indexes/bloat

backend/internal/handler/query.go:
  GET /api/queries/top?by=time&limit=20
  POST /api/query/execute        — run arbitrary SQL (read-only by
default)
  POST /api/query/explain        — EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)
  POST /api/statements/reset     — reset pg_stat_statements

backend/internal/handler/locks.go:
  GET /api/locks                 — current locks
  GET /api/locks/conflicts       — blocking chains

backend/internal/handler/replication.go:
  GET /api/replication/status
  GET /api/replication/slots
  GET /api/replication/wal

backend/internal/handler/vacuum.go:
  GET /api/vacuum/progress
  GET /api/vacuum/workers
  GET /api/vacuum/needed
  POST /api/vacuum/:schema/:table          — trigger VACUUM
  POST /api/vacuum/:schema/:table/analyze  — trigger ANALYZE

backend/internal/handler/system.go:
  GET /api/system/cpu
  GET /api/system/memory
  GET /api/system/disk
  GET /api/system/disk/io
  GET /api/system/network
  GET /api/system/processes      — PG process tree

backend/internal/handler/metrics.go:
  GET /api/metrics/history?duration=5m  — historical snapshots for
charts

backend/internal/handler/checkpoint.go:
  GET /api/checkpoint/stats

Router: backend/cmd/server/main.go using chi.
Middleware: CORS (allow frontend origin), request logging (zerolog),
  recovery, request ID.

Every handler should:
- Accept context from request
- Use the service layer (not query PG directly)
- Return JSON with proper error responses {error: string, code: int}
- Use proper HTTP status codes"
```

---

## Phase 2: Frontend — Dashboard UI (Days 4–8)

### 2.1 Prompt: App Shell

```
claude "Create the frontend app shell:

- Dark theme by default (PostgreSQL blue accent: #336791)
- Sidebar navigation (collapsible, 240px):
  - Overview (home icon)
  - Activity Monitor
  - Databases
  - Tables & Indexes
  - Query Analysis
  - SQL Editor
  - Replication
  - Locks
  - Vacuum
  - System (CPU/Memory/Disk/Network)
  - Server Config
  - Alerts
- Top bar: PostgreSQL connection status dot (green/red), server version,
  uptime, current database name
- Status bar at bottom: last refresh time, WebSocket status,
  active connections count

Use React Router v6 for routing.
Create hooks/useWebSocket.ts — connects to ws://localhost:4000/ws with
  auto-reconnect (reconnecting-websocket library).
Create hooks/useFetch.ts — generic fetch hook with loading/error states.
Create lib/api.ts — typed API client with base URL from env."
```

### 2.2 Prompt: Overview Page

```
claude "Create pages/Overview.tsx — the main dashboard:

Row 1 — 6 stat cards in a grid:
  - Active Connections (number / max_connections)
  - TPS (transactions per second, commit + rollback)
  - Cache Hit Ratio (percentage with color: green >99%, yellow >95%, red
    below)
  - Database Size (total across all databases)
  - CPU Usage (percent)
  - Disk I/O (read + write MB/s)

Row 2 — 2 large charts side by side (from WebSocket real-time data):
  - Left: TPS over time (last 5 min, line chart, commit in green,
    rollback in red)
  - Right: Connection states over time (stacked area: active, idle, idle
    in transaction)

Row 3 — 2 large charts:
  - Left: CPU usage over time (line chart: user, system, iowait)
  - Right: Disk I/O over time (line chart: read MB/s, write MB/s)

Row 4 — 2 tables:
  - Left: Top 5 longest running queries (pid, duration, query truncated,
    cancel button)
  - Right: Top 5 queries by total_exec_time from pg_stat_statements

All real-time charts update every 2 seconds from WebSocket.
Stat cards animate value changes with smooth transitions.
Charts show last 5 minutes of data from the rolling buffer."
```

### 2.3 Prompt: Activity Monitor

```
claude "Create pages/Activity.tsx:

Main table showing all connections from pg_stat_activity:
- Columns: PID, User, Database, Client IP, State, Wait Event, Duration,
  Backend Type, Query (truncated to 100 chars)
- Row colors: green=active, yellow=idle in transaction, gray=idle,
  red=waiting
- Click row: expand to show full query text, execution plan button
- Filters bar: state dropdown, database dropdown, user dropdown, search
  query text
- Actions: Cancel Query button (pg_cancel_backend), Terminate button
  (pg_terminate_backend) — both with confirmation dialog
- Sort by any column (click header)
- Auto-refresh every 2 seconds

Summary panel at top:
- Horizontal bar chart: connections by state
- Pie chart: connections by database
- Number cards: total, active, idle, idle in transaction, blocked

Blocked queries section:
- Table of blocked/blocking pairs
- Tree view showing blocking chains (blocker → blocked → blocked by
  that)"
```

### 2.4 Prompt: Database & Table Explorer

```
claude "Create pages/Databases.tsx:
- Card grid, one per database
- Each card shows: name, size (human readable), connections count,
  cache hit ratio (gauge), TPS, temp files generated
- Click card: navigate to tables view for that database

Create pages/Tables.tsx:
- Database selector at top
- Table with columns: Schema, Table, Total Size, Table Size, Index Size,
  Estimated Rows, Dead Tuples, Dead Tuple %, Seq Scans, Idx Scans,
  Last Vacuum, Last Analyze
- Color highlights:
  - Dead tuple % > 10%: red background
  - No index scans but has indexes: yellow
  - Never vacuumed: orange
  - Table size > 1GB: bold
- Click table row: detail side panel with:
  - I/O stats (heap/index/toast blocks read vs hit)
  - Cache hit ratio for this table
  - Indexes on this table
  - Action buttons: VACUUM, VACUUM FULL, ANALYZE
- Sort by any column
- Search/filter by table name"
```

### 2.5 Prompt: System Monitoring Page

```
claude "Create pages/System.tsx — OS-level monitoring:

This is critical — shows the machine's resource usage where PostgreSQL
runs.

Section 1 — CPU:
- Overall CPU gauge (big circle, percentage)
- Load average display (1, 5, 15 min)
- CPU usage over time chart (stacked area: user, system, iowait, steal,
  idle)
- Per-core CPU bar chart (horizontal bars, one per core)

Section 2 — Memory:
- Memory gauge (used / total)
- Breakdown bar: used | buffers | cached | free
- Memory over time chart
- Swap usage (if any)
- PostgreSQL shared_buffers vs actual available memory comparison

Section 3 — Disk:
- Per-mount-point usage bars (used/total, highlight PGDATA mount)
- Disk I/O chart over time (read/write IOPS, read/write throughput MB/s)
- I/O latency if available (io_time / read_count)
- Current IOPS counter

Section 4 — Network:
- Per-interface throughput chart (in/out MB/s)
- Packet error/drop counters

Section 5 — PostgreSQL Processes:
- Process tree table: pid, type
  (postmaster/checkpointer/bgwriter/walwriter/
  autovacuum/backend/etc.), CPU%, MEM%, RSS, state
- Total PG memory footprint

All sections update in real-time from WebSocket."
```

### 2.6 Prompt: Query Analysis Page

```
claude "Create pages/Queries.tsx:

Requires pg_stat_statements extension.
Show a banner with install instructions if not available.

Tab bar: By Total Time | By Calls | By Rows | By Temp Usage

Main table:
- Query (normalized, truncated), Calls, Total Time, Mean Time, Min/Max
  Time,
  Rows, Shared Blks Hit, Shared Blks Read, Hit Ratio, Temp Blks Written
- Click row to expand:
  - Full query text (with syntax highlighting)
  - EXPLAIN ANALYZE button → shows execution plan
  - Execution time distribution (min/mean/max as a range bar)
  - I/O breakdown: shared hit/read, local hit/read, temp read/write
  - WAL stats: records, FPI, bytes

Execution plan viewer:
- Parse EXPLAIN (FORMAT JSON) output
- Tree view with node types, actual rows, planned rows, time, buffers
- Highlight nodes where actual >> planned (bad estimates)
- Show sequential scans on large tables in red

Top right: Reset Statistics button (with confirmation)."
```

### 2.7 Prompt: SQL Editor

```
claude "Create pages/SQLEditor.tsx:

- Code editor: use CodeMirror 6 (load @codemirror/lang-sql from CDN)
  with PostgreSQL dialect, dark theme
- Execute button + Ctrl+Enter shortcut
- EXPLAIN ANALYZE toggle button
- Read-Only mode toggle (wraps in BEGIN; ... ROLLBACK;)
- Results panel below editor:
  - Table view for SELECT results with pagination (50 rows per page)
  - Row count and execution time display
  - For EXPLAIN: plan tree visualization
  - Error display with line highlight
- Query history sidebar (last 50 queries, stored in React state)
- Export results as CSV button
- Multi-tab support: multiple query tabs"
```

### 2.8 Prompt: Replication, Locks, Vacuum Pages

```
claude "Create pages/Replication.tsx:
- Replication status table: application_name, client_addr, state,
  sent/write/flush/replay LSN, write_lag, flush_lag, replay_lag
- Replication slots table with WAL status
- WAL generation rate chart over time
- Visual: primary → replica arrows with lag values

Create pages/Locks.tsx:
- Current locks table: locktype, relation, mode, granted, pid, query
- Blocking chains: tree visualization
  Parent node = blocking PID, children = blocked PIDs
  Show query and duration for each
- Action: terminate blocking PID (with confirmation)
- Lock type distribution pie chart

Create pages/Vacuum.tsx:
- Autovacuum workers table (currently running)
- Vacuum progress for running operations (phase,
  heap_blks_total/scanned/vacuumed)
- Tables needing vacuum (high dead tuples, long since last vacuum)
  with one-click VACUUM and ANALYZE buttons
- Autovacuum settings display (autovacuum_vacuum_threshold,
  scale_factor, etc.)"
```

### 2.9 Prompt: Server Config Viewer

```
claude "Create pages/ServerConfig.tsx:

- Read from /api/server/config
- Group settings by category (from pg_settings.category):
  Autovacuum, Client Connection Defaults, Connections and
Authentication,
  Error Handling, File Locations, Lock Management, Memory,
  Query Tuning, Replication, Resource Usage, WAL, Write Ahead Log
- Each setting shows: name, current value, unit, default value, source,
  pending_restart flag
- Highlight non-default values in blue
- Highlight pending_restart = true in red with warning icon
- Search/filter by setting name
- Recommendations panel at top:
  - Flag shared_buffers < 25% of total RAM
  - Flag effective_cache_size < 50% of total RAM
  - Flag work_mem warnings for high connection counts
  - Flag wal_level = minimal when replication slots exist
  - Flag random_page_cost = 4 when using SSDs"
```

---

## Phase 3: Alerting & Snapshots (Days 9–11)

### 3.1 Prompt: Alert Engine

```
claude "Create backend/internal/alert/engine.go:

Alert rules engine:
- Rules are configurable (start with sensible defaults in config)
- Default rules:
  - Connection count > 80% of max_connections → warning
  - Connection count > 95% of max_connections → critical
  - Long running query > 60 seconds → warning
  - Long running query > 300 seconds → critical
  - Idle in transaction > 30 seconds → warning
  - Cache hit ratio < 99% → warning
  - Cache hit ratio < 95% → critical
  - Replication lag > 5 seconds → warning
  - Replication lag > 30 seconds → critical
  - Dead tuple ratio > 10% on any table → warning
  - Dead tuple ratio > 20% → critical
  - CPU usage > 80% → warning
  - CPU iowait > 20% → warning
  - Disk usage > 80% → warning
  - Disk usage > 90% → critical

- Alert struct: id, rule_name, severity (info/warning/critical),
  message,
  timestamp, resolved bool, resolved_at
- Store alerts in memory (last 1000)
- Broadcast new alerts via WebSocket
- Auto-resolve when condition clears
- Cooldown: don't re-fire same alert within 5 minutes

Frontend: pages/Alerts.tsx:
- Bell icon in top bar with badge count (unresolved alerts)
- Alert list: timestamp, severity, message, status (active/resolved)
- Filter by severity
- Alert history chart: alerts over time"
```

### 3.2 Prompt: Performance Snapshots

```
claude "Add snapshot storage:

backend/internal/service/snapshot.go:
- Take a full MetricsSnapshot every 5 minutes
- Store in a local SQLite database (mattn/go-sqlite3) with:
  CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL  -- full metrics snapshot as JSON
  )
- Keep last 7 days of snapshots, auto-cleanup
- API: GET /api/snapshots?from=...&to=... — return snapshots in range
- API: GET /api/snapshots/compare?t1=...&t2=... — delta between two
  snapshots

Frontend: add time range selector component that can show
historical data in charts (switch from real-time to historical mode)."
```

---

## Phase 4: Polish & Production (Days 12–14)

### 4.1 Prompt: Production Build

```
claude "Create production Docker setup:

docker/Dockerfile.backend:
- Multi-stage: Go builder → scratch/alpine runtime
- CGO_ENABLED=1 for go-sqlite3
- Binary at /app/pg-dashboard

docker/Dockerfile.frontend:
- Multi-stage: Node builder → nginx:alpine
- Build Vite app → serve static files
- Nginx config with /api proxy to backend

docker/docker-compose.prod.yml:
- Backend service (expose 4000)
- Frontend+nginx service (expose 80, proxy /api → backend:4000)
- Environment variables for PG_DSN, JWT_SECRET, etc.
- Health check endpoints: GET /api/health on backend
- Restart policies

Add Makefile targets at root: docker-build, docker-up, docker-down"
```

### 4.2 Prompt: Authentication

```
claude "Add basic auth to the backend:

- Simple username/password from config (ADMIN_USER, ADMIN_PASSWORD env
  vars)
- Password stored as bcrypt hash
- POST /api/login → returns JWT token (24h expiry)
- Middleware: verify JWT on all /api/* routes except /api/login and
  /api/health
- Frontend: login page, store token in memory (not localStorage),
  include in Authorization header
- Auto-redirect to login when 401 received"
```

### 4.3 Prompt: Tests

```
claude "Add tests:

Backend:
- query/ package: test that all SQL strings are valid syntax
  (parse with pgx.ParseConfig mock or use crdbpgx parser)
- handler/ package: HTTP tests with httptest.NewServer + mock service
- monitor/os: test that collectors return non-zero values
- Integration test: connect to real PG (gated by TEST_PG_DSN env var),
  run all queries, verify non-error responses

Frontend:
- Vitest + React Testing Library
- Test stat card rendering with mock data
- Test WebSocket hook reconnection logic
- Test API client error handling

Makefile: make test-unit, make test-integration"
```

---

## Claude Code Workflow

### Custom Commands

```markdown
# .claude/commands/add-endpoint.md
Add a new API endpoint to the Go backend:
1. Add the SQL query as a Go constant in backend/internal/query/
2. Add the response model struct in backend/internal/model/
3. Add the service method in backend/internal/service/
4. Add the HTTP handler in backend/internal/handler/
5. Register the route in cmd/server/main.go
6. Add the TypeScript type in frontend/src/types/
7. Add the API call in frontend/src/lib/api.ts

Endpoint: $ARGUMENTS
```

```markdown
# .claude/commands/add-page.md
Add a new dashboard page:
1. Create frontend/src/pages/<Name>.tsx
2. Add route in App.tsx
3. Add sidebar nav entry
4. Create any needed components in frontend/src/components/
5. Wire up API calls and WebSocket subscriptions

Page: $ARGUMENTS
```

### Session Pattern

```bash
# Day start
cd pg-dashboard
claude --dangerously-skip-permissions --continue

# If starting fresh on a new phase
claude --dangerously-skip-permissions
> "Read CLAUDE.md. We're starting Phase 2. The backend API is complete
>  and running on port 4000. Create the frontend Overview page with
>  real-time charts connected to the WebSocket."
```

---

## Timeline

| Phase | Days | Deliverable |
|-------|------|-------------|
| 0: Bootstrap | 1 | Project scaffold, Go builds, React runs, PG
connects |
| 1: Backend | 2 | All REST + WebSocket endpoints, PG + OS metrics |
| 2: Frontend | 5 | All dashboard pages with real-time data |
| 3: Alerts | 3 | Alert engine, snapshots, historical comparison |
| 4: Polish | 2 | Docker prod, auth, tests |
| **Total** | **~13 days** | |

---

## Key PG Monitoring Views Used

For reference — the complete set of PostgreSQL system views/functions
this dashboard queries:

| View/Function | Purpose |
|---|---|
| `pg_stat_activity` | Active sessions, queries, wait events |
| `pg_stat_database` | Per-DB stats: TPS, cache, temp files, deadlocks |
| `pg_stat_user_tables` | Table-level DML stats, vacuum times, dead
tuples |
| `pg_statio_user_tables` | Table-level I/O (heap/index/toast blocks) |
| `pg_stat_user_indexes` | Index usage stats (scans, tuples fetched) |
| `pg_stat_statements` | Query-level performance (time, calls, buffers,
WAL) |
| `pg_stat_bgwriter` | Checkpoint and bgwriter buffer stats |
| `pg_stat_wal` | WAL generation stats (PG 14+) |
| `pg_stat_replication` | Replica lag, LSN positions |
| `pg_stat_progress_vacuum` | Running vacuum progress |
| `pg_replication_slots` | Replication slot status |
| `pg_locks` | Current lock state |
| `pg_blocking_pids()` | Blocking chain resolution |
| `pg_settings` / `pg_file_settings` | Server configuration |
| `pg_database` | Database metadata and sizes |
| `pg_index` | Index column definitions (duplicate detection) |
| `pg_database_size()` | Database disk usage |
| `pg_total_relation_size()` | Table + index + toast size |
| `pg_cancel_backend()` | Cancel a running query |
| `pg_terminate_backend()` | Kill a connection |
| `pg_stat_statements_reset()` | Reset query stats |

## Reference Projects

| Repo | Relevance |
|---|---|
|
[agent-character-dashboard](https://github.com/mzd-hseokkim/agent-character-dashboard)
| Real-time monitoring: Bun + SQLite + React + WebSocket |
|
[fullstack_todo_app](https://github.com/talhabinhussain/fullstack_todo_app)
| Spec-driven Claude Code: Next.js + FastAPI + PostgreSQL |
|
[react-nodejs-fullstack-template](https://github.com/adamoates/react-nodejs-fullstack-template)
| 2,500-line CLAUDE.md for Claude Code workflows |
| [systematic-dev-kit](https://github.com/dkoenawan/systematic-dev-kit)
| Claude Code plugin: database + backend + frontend skills |

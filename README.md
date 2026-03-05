# PG Dash

**A full-featured PostgreSQL monitoring dashboard, built from scratch with AI in 24 hours.**

Connect to any existing PostgreSQL instance and get instant visibility into connections, queries, locks, replication, system resources, and more — all through a modern dark-themed web UI with live-updating charts.

![PG Dash Screenshot](docs/screenshot.jpeg)

## Features

- **Overview** — stat cards (connections, TPS, cache hit ratio, DB size, CPU, disk I/O) and real-time charts
- **Activity Monitor** — live view of `pg_stat_activity` with filtering, query cancellation, and blocking chain visualization
- **Databases** — per-database stats, sizes, cache hit ratios, and table drill-down
- **Query Analysis** — top queries from `pg_stat_statements` by time, calls, rows, or temp usage with EXPLAIN support
- **SQL Editor** — execute arbitrary SQL with results table, EXPLAIN visualization, and read-only mode
- **System** — CPU, memory, disk, network, and PostgreSQL process monitoring via gopsutil
- **Replication** — replica lag, LSN positions, replication slots, and WAL stats
- **Locks** — current locks, blocking chains as tree visualizations, one-click termination
- **Vacuum** — autovacuum workers, vacuum progress, tables needing vacuum with one-click actions
- **Server Config** — full `pg_settings` viewer grouped by category with optimization recommendations
- **Alerts** — configurable rules engine with real-time notifications for connections, queries, replication lag, disk usage, etc.
- **WebSocket** — all metrics broadcast every 2 seconds for truly live dashboards
- **Historical Snapshots** — 5-minute snapshots stored locally with 7-day retention for time-range comparison

## Architecture

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
│  (Chi + pgx/v5 + gorilla/websocket + gopsutil)          │
│         http://localhost:4001                            │
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
│             PostgreSQL Instance (external)                │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.22+ / Chi router / pgx v5 / gopsutil v4 / gorilla/websocket / zerolog |
| Frontend | React 19 / Vite / TypeScript / Tailwind CSS / Recharts |
| Database | Any PostgreSQL 14+ instance (external — not bundled) |

## Quick Start

### Prerequisites

- **Go** 1.22+
- **Node.js** 18+
- A running **PostgreSQL** 14+ instance

### 1. Clone and install dependencies

```bash
git clone https://github.com/avamingli/pg-dash.git
cd pg-dash
cd frontend && npm install && cd ..
```

### 2. Configure

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env

# PostgreSQL connection string
PG_DSN=postgres://user:password@localhost:5432/postgres?sslmode=disable

# Backend port
PORT=4001

# Frontend port
FRONTEND_PORT=3000
```

### 3. Start

```bash
make dev
```

This single command builds the Go backend, starts it on the configured port, and launches the Vite dev server. Open http://localhost:3000 in your browser.

Press `Ctrl+C` to stop both services.

### Optional: pg_stat_statements

For the **Query Analysis** page to work, enable the `pg_stat_statements` extension:

```sql
-- In postgresql.conf:
-- shared_preload_libraries = 'pg_stat_statements'
-- Then restart PostgreSQL, and run:

CREATE EXTENSION pg_stat_statements;
```

## Available Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start both frontend and backend |
| `make dev-backend` | Start backend only |
| `make dev-frontend` | Start frontend only |
| `make build` | Build production backend binary and frontend bundle |
| `make test` | Run backend unit tests |
| `make test-frontend` | Run frontend tests |
| `make stop` | Kill any running dashboard processes |
| `make clean` | Remove build artifacts |

## Docker

```bash
# Development
make docker-build
make docker-up        # starts on ports 4000 (backend) + 3000 (frontend)
make docker-down

# Production (nginx reverse proxy on port 80)
make docker-prod-up
make docker-prod-down
```

Set `PG_DSN` in your environment or `.env` file before running Docker commands.

## Project Structure

```
pg-dash/
├── backend/
│   ├── cmd/server/          # Entry point
│   └── internal/
│       ├── alert/           # Alert rules engine
│       ├── config/          # Viper-based config loading
│       ├── handler/         # HTTP handlers (one file per resource)
│       ├── middleware/       # Auth, CORS, logging
│       ├── model/           # Go structs with JSON tags
│       ├── monitor/
│       │   ├── os/          # OS metrics via gopsutil (CPU, mem, disk, net)
│       │   └── pg/          # PostgreSQL metrics via pgx
│       ├── query/           # Raw SQL as Go string constants
│       ├── service/         # Connection manager, snapshot store
│       └── ws/              # WebSocket hub and client management
├── frontend/
│   └── src/
│       ├── components/      # Reusable UI (StatCard, TopBar, Sidebar, etc.)
│       ├── contexts/        # React contexts (Metrics, Auth)
│       ├── hooks/           # useWebSocket, useFetch
│       ├── lib/             # API client, utilities
│       ├── pages/           # Dashboard pages (Overview, Activity, System, etc.)
│       └── types/           # TypeScript interfaces matching Go models
├── docker/                  # Dockerfiles and compose configs
├── docs/                    # Screenshots and documentation
├── .env                     # Configuration (ports, PG_DSN)
├── Makefile                 # Build, dev, test, docker commands
└── LICENSE                  # Apache 2.0
```

## PostgreSQL Views Used

| View / Function | Purpose |
|---|---|
| `pg_stat_activity` | Active sessions, queries, wait events |
| `pg_stat_database` | Per-DB stats: TPS, cache, temp files, deadlocks |
| `pg_stat_user_tables` | Table-level DML stats, vacuum times, dead tuples |
| `pg_statio_user_tables` | Table-level I/O (heap/index/toast blocks) |
| `pg_stat_user_indexes` | Index usage stats |
| `pg_stat_statements` | Query-level performance (time, calls, buffers, WAL) |
| `pg_stat_bgwriter` | Checkpoint and bgwriter buffer stats |
| `pg_stat_wal` | WAL generation stats (PG 14+) |
| `pg_stat_replication` | Replica lag, LSN positions |
| `pg_stat_progress_vacuum` | Running vacuum progress |
| `pg_replication_slots` | Replication slot status |
| `pg_locks` | Current lock state |
| `pg_blocking_pids()` | Blocking chain resolution |
| `pg_settings` | Server configuration |

## Authentication

Optional basic authentication can be enabled by setting environment variables:

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=your-secure-password
JWT_SECRET=your-jwt-secret
```

When set, the dashboard requires login. JWT tokens are issued with 24-hour expiry.

## License

Copyright 2026 Zhang Mingli

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

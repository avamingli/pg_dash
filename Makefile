# ── pg-dash Makefile ──
# Config: edit the root .env file
# Start:  make dev

.PHONY: dev dev-backend dev-frontend build test test-unit test-integration \
       test-frontend stop clean \
       docker-build docker-up docker-down docker-prod-up docker-prod-down

# Load config from .env (if it exists)
ifneq (,$(wildcard ./.env))
  include .env
  export
endif

# Defaults
PORT         ?= 4001
FRONTEND_PORT ?= 3000
PG_DSN       ?= postgres://gpadmin@localhost:17000/postgres?sslmode=disable

# ── Development ──

# Start both frontend and backend (Ctrl+C stops both)
dev: build-backend
	@echo "──────────────────────────────────────"
	@echo "  pg-dash"
	@echo "  Backend:  http://localhost:$(PORT)"
	@echo "  Frontend: http://localhost:$(FRONTEND_PORT)"
	@echo "  PG_DSN:   $(PG_DSN)"
	@echo "──────────────────────────────────────"
	@trap 'kill 0' EXIT; \
	  PG_DSN="$(PG_DSN)" PORT=$(PORT) ./backend/server 2>&1 & \
	  BACKEND_PORT=$(PORT) FRONTEND_PORT=$(FRONTEND_PORT) \
	    npm run --prefix frontend dev 2>&1 & \
	  wait

# Start backend only
dev-backend: build-backend
	PG_DSN="$(PG_DSN)" PORT=$(PORT) ./backend/server

# Start frontend only
dev-frontend:
	BACKEND_PORT=$(PORT) FRONTEND_PORT=$(FRONTEND_PORT) \
	  npm run --prefix frontend dev

# ── Build ──

build-backend:
	cd backend && go build -o server ./cmd/server

build: build-backend
	cd frontend && npm run build

# ── Testing ──

test: test-unit

test-unit:
	cd backend && go test ./internal/... -count=1 -timeout 60s

test-integration:
	cd backend && go test ./... -count=1 -timeout 120s -tags=integration

test-frontend:
	cd frontend && npm test

# ── Stop ──

stop:
	@echo "Stopping pg-dash processes..."
	-@pkill -f './backend/server' 2>/dev/null || true
	-@pkill -f 'vite.*--port' 2>/dev/null || true
	@echo "Done."

# ── Docker (development) ──

docker-build:
	docker compose -f docker/docker-compose.yml build

docker-up:
	docker compose -f docker/docker-compose.yml up -d

docker-down:
	docker compose -f docker/docker-compose.yml down

docker-logs:
	docker compose -f docker/docker-compose.yml logs -f

# ── Docker (production) ──

docker-prod-up:
	docker compose -f docker/docker-compose.prod.yml up -d --build

docker-prod-down:
	docker compose -f docker/docker-compose.prod.yml down

# ── Cleanup ──

clean:
	cd backend && make clean
	rm -rf frontend/dist backend/server

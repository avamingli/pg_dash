package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/alert"
	"github.com/avamingli/dbhouse-web/backend/internal/config"
	"github.com/avamingli/dbhouse-web/backend/internal/handler"
	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/avamingli/dbhouse-web/backend/internal/monitor"
	osmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/os"
	pgmon "github.com/avamingli/dbhouse-web/backend/internal/monitor/pg"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/avamingli/dbhouse-web/backend/internal/ws"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	// Configure zerolog
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	// Load config
	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}

	// Connect to PostgreSQL
	connMgr, err := service.NewConnectionManager(cfg.PGDSN)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to PostgreSQL")
	}
	defer connMgr.Close()

	version, err := connMgr.TestConnection(context.Background())
	if err != nil {
		log.Fatal().Err(err).Msg("failed to test PostgreSQL connection")
	}
	log.Info().Str("version", version).Msg("connected to PostgreSQL")

	// Create WebSocket hub
	hub := ws.NewHub()
	go hub.Run()

	// Create metric collectors
	pool := connMgr.GetPool()
	pgCollector := pgmon.NewCollector(pool)
	osCollector := osmon.NewSystemCollectorWithPGData(os.Getenv("PGDATA"))

	// Create alert engine
	alertEngine := alert.NewEngine(func(data []byte) {
		hub.Broadcast(data)
	})

	// Create and start aggregator (2s tick, ring buffer, WebSocket broadcast)
	agg := monitor.NewAggregator(pgCollector, osCollector, hub, alertEngine)
	agg.Start(context.Background())
	defer agg.Stop()
	log.Info().Msg("metric aggregator started (2s interval)")

	// Create snapshot store (5-min snapshots, 7-day retention)
	snapshotDir := filepath.Join(os.Getenv("HOME"), ".pg-dash", "snapshots")
	snapshotStore, err := service.NewSnapshotStore(snapshotDir, func() *model.MetricsSnapshot {
		return agg.GetLatest()
	})
	if err != nil {
		log.Warn().Err(err).Msg("failed to create snapshot store — snapshots disabled")
	} else {
		snapshotStore.Start()
		defer snapshotStore.Stop()
	}

	// Create router
	r := chi.NewRouter()

	// Middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://localhost:5173"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
		})
	})

	// WebSocket endpoint
	r.Get("/ws", func(w http.ResponseWriter, r *http.Request) {
		handler.ServeWebSocket(hub, w, r)
	})

	// API routes
	r.Route("/api", func(r chi.Router) {
		handler.RegisterServerRoutes(r, pool)
		handler.RegisterActivityRoutes(r, pool)
		handler.RegisterDatabaseRoutes(r, pool)
		handler.RegisterIndexRoutes(r, pool)
		handler.RegisterQueryRoutes(r, pool)
		handler.RegisterLockRoutes(r, pool)
		handler.RegisterReplicationRoutes(r, pool)
		handler.RegisterVacuumRoutes(r, pool)
		handler.RegisterSystemRoutes(r, agg)
		handler.RegisterCheckpointRoutes(r, pool)
		handler.RegisterMetricsRoutes(r, agg)
		handler.RegisterAlertRoutes(r, alertEngine)
		if snapshotStore != nil {
			handler.RegisterSnapshotRoutes(r, snapshotStore)
		}
	})

	// Start server
	addr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// NOTE: ReadTimeout and WriteTimeout are intentionally unset.
		// They set absolute deadlines on the underlying TCP connection
		// which kill long-lived WebSocket connections after the timeout.
		// gorilla/websocket manages its own per-operation deadlines.
	}

	// Graceful shutdown
	go func() {
		log.Info().Str("addr", addr).Msg("starting server")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info().Msg("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	agg.Stop()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal().Err(err).Msg("server forced to shutdown")
	}
	log.Info().Msg("server stopped")
}

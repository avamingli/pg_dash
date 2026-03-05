package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

type ConnectionStatus string

const (
	StatusConnected    ConnectionStatus = "connected"
	StatusDisconnected ConnectionStatus = "disconnected"
	StatusReconnecting ConnectionStatus = "reconnecting"
)

type ConnectionManager struct {
	pool   *pgxpool.Pool
	dsn    string
	mu     sync.RWMutex
	status ConnectionStatus
	// Cached server info from initial connection
	version   string
	startTime time.Time
}

// NewConnectionManager creates a pool and verifies the connection.
func NewConnectionManager(dsn string) (*ConnectionManager, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("NewConnectionManager: %w", err)
	}

	cfg.MaxConns = 10
	cfg.MinConns = 2
	cfg.HealthCheckPeriod = 30 * time.Second
	cfg.MaxConnLifetime = 1 * time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("NewConnectionManager: %w", err)
	}

	// Verify we can actually talk to the server
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("NewConnectionManager: ping failed: %w", err)
	}

	cm := &ConnectionManager{
		pool:   pool,
		dsn:    dsn,
		status: StatusConnected,
	}

	return cm, nil
}

// TestConnection runs SELECT version() and returns the version string.
func (cm *ConnectionManager) TestConnection(ctx context.Context) (string, error) {
	var version string
	err := cm.pool.QueryRow(ctx, "SELECT version()").Scan(&version)
	if err != nil {
		cm.setStatus(StatusDisconnected)
		return "", fmt.Errorf("TestConnection: %w", err)
	}
	cm.mu.Lock()
	cm.version = version
	cm.mu.Unlock()
	cm.setStatus(StatusConnected)
	return version, nil
}

// GetServerStartTime queries pg_postmaster_start_time and caches it.
func (cm *ConnectionManager) GetServerStartTime(ctx context.Context) (time.Time, error) {
	cm.mu.RLock()
	if !cm.startTime.IsZero() {
		t := cm.startTime
		cm.mu.RUnlock()
		return t, nil
	}
	cm.mu.RUnlock()

	var startTime time.Time
	err := cm.pool.QueryRow(ctx, "SELECT pg_postmaster_start_time()").Scan(&startTime)
	if err != nil {
		return time.Time{}, fmt.Errorf("GetServerStartTime: %w", err)
	}

	cm.mu.Lock()
	cm.startTime = startTime
	cm.mu.Unlock()
	return startTime, nil
}

// GetPool returns the underlying pgxpool.Pool.
func (cm *ConnectionManager) GetPool() *pgxpool.Pool {
	return cm.pool
}

// Status returns the current connection status.
func (cm *ConnectionManager) Status() ConnectionStatus {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.status
}

// Version returns the cached PG version string.
func (cm *ConnectionManager) Version() string {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.version
}

// PoolStats returns live pool statistics.
func (cm *ConnectionManager) PoolStats() *pgxpool.Stat {
	return cm.pool.Stat()
}

// Reconnect tears down the current pool and creates a new one with
// exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s).
func (cm *ConnectionManager) Reconnect(ctx context.Context) error {
	cm.setStatus(StatusReconnecting)
	log.Warn().Msg("starting reconnection to PostgreSQL")

	// Close existing pool
	cm.pool.Close()

	backoff := 1 * time.Second
	maxBackoff := 30 * time.Second
	maxAttempts := 10

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			cm.setStatus(StatusDisconnected)
			return fmt.Errorf("Reconnect: context cancelled: %w", ctx.Err())
		default:
		}

		log.Info().Int("attempt", attempt).Dur("backoff", backoff).Msg("reconnecting to PostgreSQL")

		cfg, err := pgxpool.ParseConfig(cm.dsn)
		if err != nil {
			cm.setStatus(StatusDisconnected)
			return fmt.Errorf("Reconnect: parse config: %w", err)
		}
		cfg.MaxConns = 10
		cfg.MinConns = 2
		cfg.HealthCheckPeriod = 30 * time.Second
		cfg.MaxConnLifetime = 1 * time.Hour
		cfg.MaxConnIdleTime = 30 * time.Minute

		connCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		pool, err := pgxpool.NewWithConfig(connCtx, cfg)
		cancel()

		if err == nil {
			pingCtx, pingCancel := context.WithTimeout(ctx, 3*time.Second)
			err = pool.Ping(pingCtx)
			pingCancel()

			if err == nil {
				cm.mu.Lock()
				cm.pool = pool
				cm.status = StatusConnected
				// Clear cached start time so it gets refreshed
				cm.startTime = time.Time{}
				cm.mu.Unlock()
				log.Info().Int("attempt", attempt).Msg("reconnected to PostgreSQL")
				return nil
			}
			pool.Close()
		}

		log.Warn().Err(err).Int("attempt", attempt).Msg("reconnection attempt failed")

		// Wait with backoff
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			cm.setStatus(StatusDisconnected)
			return fmt.Errorf("Reconnect: context cancelled during backoff: %w", ctx.Err())
		case <-timer.C:
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}

	cm.setStatus(StatusDisconnected)
	return fmt.Errorf("Reconnect: failed after %d attempts", maxAttempts)
}

// Close gracefully shuts down the connection pool.
func (cm *ConnectionManager) Close() {
	cm.setStatus(StatusDisconnected)
	cm.pool.Close()
	log.Info().Msg("PostgreSQL connection pool closed")
}

func (cm *ConnectionManager) setStatus(s ConnectionStatus) {
	cm.mu.Lock()
	cm.status = s
	cm.mu.Unlock()
}

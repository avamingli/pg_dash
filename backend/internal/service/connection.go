package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// ClusterMode identifies the database type.
type ClusterMode string

const (
	ModePostgreSQL ClusterMode = "postgresql"
	ModeCloudberry ClusterMode = "cloudberry"
)

// ClusterInfo holds detected distributed cluster metadata.
type ClusterInfo struct {
	Mode        ClusterMode `json:"mode"`
	Version     string      `json:"version"`      // e.g. "3.0.0-devel"
	PGVersion   string      `json:"pg_version"`    // e.g. "14.4"
	NumSegments int         `json:"num_segments"`  // primary segments (excl coordinator)
	HasMirrors  bool        `json:"has_mirrors"`
	ResourceMgr string     `json:"resource_mgr"`  // "queue" or "group"
}

// IsDistributed returns true if the cluster is a distributed database (Cloudberry/CBDB).
func (ci *ClusterInfo) IsDistributed() bool {
	return ci.Mode == ModeCloudberry
}

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
	version     string
	startTime   time.Time
	clusterInfo *ClusterInfo
	// Per-database pool cache (key = database name)
	dbPools map[string]*pgxpool.Pool
	dbMu    sync.RWMutex
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
		pool:    pool,
		dsn:     dsn,
		status:  StatusConnected,
		dbPools: make(map[string]*pgxpool.Pool),
	}

	return cm, nil
}

// TestConnection runs SELECT version() and returns the version string.
// It also detects distributed cluster mode (Cloudberry/CBDB).
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

	// Detect cluster mode
	ci := cm.detectClusterMode(ctx, version)
	cm.mu.Lock()
	cm.clusterInfo = ci
	cm.mu.Unlock()

	return version, nil
}

// GetClusterInfo returns the detected cluster info, or nil if not yet detected.
func (cm *ConnectionManager) GetClusterInfo() *ClusterInfo {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.clusterInfo
}

func (cm *ConnectionManager) detectClusterMode(ctx context.Context, version string) *ClusterInfo {
	ci := &ClusterInfo{Mode: ModePostgreSQL}

	// Extract PG version: "PostgreSQL 14.4 ..."
	if idx := strings.Index(version, "PostgreSQL "); idx >= 0 {
		rest := version[idx+len("PostgreSQL "):]
		if sp := strings.IndexAny(rest, " ("); sp > 0 {
			ci.PGVersion = rest[:sp]
		}
	}

	// Detect Cloudberry / Greenplum (both map to ModeCloudberry)
	if strings.Contains(version, "Apache Cloudberry") {
		ci.Mode = ModeCloudberry
		ci.Version = extractParenVersion(version, "Apache Cloudberry")
	} else if strings.Contains(version, "Greenplum Database") {
		ci.Mode = ModeCloudberry
		ci.Version = extractParenVersion(version, "Greenplum Database")
	} else {
		return ci // plain PostgreSQL
	}

	// Query segment topology
	var numPrimaries, numMirrors int
	err := cm.pool.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE content >= 0 AND role = 'p'),
			count(*) FILTER (WHERE content >= 0 AND role = 'm')
		FROM gp_segment_configuration
	`).Scan(&numPrimaries, &numMirrors)
	if err != nil {
		log.Warn().Err(err).Msg("detectClusterMode: failed to query gp_segment_configuration")
		return ci
	}
	ci.NumSegments = numPrimaries
	ci.HasMirrors = numMirrors > 0

	// Query resource manager
	var resMgr string
	err = cm.pool.QueryRow(ctx, "SELECT current_setting('gp_resource_manager')").Scan(&resMgr)
	if err != nil {
		log.Warn().Err(err).Msg("detectClusterMode: failed to query gp_resource_manager")
	} else {
		ci.ResourceMgr = resMgr
	}

	return ci
}

// extractParenVersion extracts version from "(Apache Cloudberry 3.0.0-devel...build ...)"
func extractParenVersion(full, prefix string) string {
	idx := strings.Index(full, prefix)
	if idx < 0 {
		return ""
	}
	rest := full[idx+len(prefix):]
	rest = strings.TrimLeft(rest, " ")
	// Take until space or "+"
	if end := strings.IndexAny(rest, " +)"); end > 0 {
		return rest[:end]
	}
	return rest
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

// GetPool returns the underlying pgxpool.Pool (for the default database).
func (cm *ConnectionManager) GetPool() *pgxpool.Pool {
	return cm.pool
}

// GetPoolForDB returns a connection pool for the given database name.
// If dbname matches the default DSN database, returns the main pool.
// Otherwise creates and caches a smaller pool for that database.
func (cm *ConnectionManager) GetPoolForDB(ctx context.Context, dbname string) (*pgxpool.Pool, error) {
	// Check if it's the default database
	defaultCfg, err := pgxpool.ParseConfig(cm.dsn)
	if err == nil && defaultCfg.ConnConfig.Database == dbname {
		return cm.pool, nil
	}

	// Check cache
	cm.dbMu.RLock()
	if p, ok := cm.dbPools[dbname]; ok {
		cm.dbMu.RUnlock()
		return p, nil
	}
	cm.dbMu.RUnlock()

	// Create new pool for this database
	cfg, err := pgxpool.ParseConfig(cm.dsn)
	if err != nil {
		return nil, fmt.Errorf("GetPoolForDB: %w", err)
	}
	cfg.ConnConfig.Database = dbname
	cfg.MaxConns = 3
	cfg.MinConns = 1
	cfg.HealthCheckPeriod = 30 * time.Second
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 10 * time.Minute

	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("GetPoolForDB(%s): %w", dbname, err)
	}

	cm.dbMu.Lock()
	// Double-check in case another goroutine created it
	if existing, ok := cm.dbPools[dbname]; ok {
		cm.dbMu.Unlock()
		p.Close()
		return existing, nil
	}
	cm.dbPools[dbname] = p
	cm.dbMu.Unlock()

	log.Info().Str("database", dbname).Msg("created per-database connection pool")
	return p, nil
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

// Close gracefully shuts down all connection pools.
func (cm *ConnectionManager) Close() {
	cm.setStatus(StatusDisconnected)
	cm.dbMu.Lock()
	for name, p := range cm.dbPools {
		p.Close()
		delete(cm.dbPools, name)
	}
	cm.dbMu.Unlock()
	cm.pool.Close()
	log.Info().Msg("PostgreSQL connection pools closed")
}

func (cm *ConnectionManager) setStatus(s ConnectionStatus) {
	cm.mu.Lock()
	cm.status = s
	cm.mu.Unlock()
}

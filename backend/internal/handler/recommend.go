package handler

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/avamingli/dbhouse-web/backend/internal/model"
	"github.com/avamingli/dbhouse-web/backend/internal/recommend"
	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RegisterRecommendRoutes registers /recommendations/* endpoints.
func RegisterRecommendRoutes(r chi.Router, pool *pgxpool.Pool, ci *service.ClusterInfo) {
	scanner := recommend.NewScanner(pool, ci)
	h := &recommendHandler{
		scanner: scanner,
		pool:    pool,
	}

	r.Get("/recommendations", h.getRecommendations)
	r.Post("/recommendations/scan", h.triggerScan)
	r.Post("/recommendations/action", h.executeAction)
}

type recommendHandler struct {
	scanner *recommend.Scanner
	pool    *pgxpool.Pool
	mu      sync.RWMutex
	cached  *model.ScanResult
}

func (h *recommendHandler) getRecommendations(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	result := h.cached
	h.mu.RUnlock()

	if result == nil {
		writeJSON(w, &model.ScanResult{
			Recommendations: []model.Recommendation{},
			Summary:         model.ScanSummary{ByCategory: map[string]int{}},
		})
		return
	}
	writeJSON(w, result)
}

func (h *recommendHandler) triggerScan(w http.ResponseWriter, r *http.Request) {
	result, err := h.scanner.Scan(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.mu.Lock()
	h.cached = result
	h.mu.Unlock()

	writeJSON(w, result)
}

func (h *recommendHandler) executeAction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SQL string `json:"sql"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.SQL == "" {
		writeError(w, http.StatusBadRequest, "sql is required")
		return
	}

	_, err := h.pool.Exec(r.Context(), body.SQL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

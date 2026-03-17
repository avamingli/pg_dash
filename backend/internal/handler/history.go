package handler

import (
	"net/http"
	"strconv"

	"github.com/avamingli/dbhouse-web/backend/internal/service"
	"github.com/go-chi/chi/v5"
)

// RegisterHistoryRoutes registers /history/* endpoints.
func RegisterHistoryRoutes(r chi.Router, historySvc *service.HistoryService) {
	h := &historyHandler{svc: historySvc}

	r.Get("/history", h.search)
	r.Get("/history/{id}", h.getByID)
	r.Get("/history/stats", h.stats)
}

type historyHandler struct {
	svc *service.HistoryService
}

func (h *historyHandler) search(w http.ResponseWriter, r *http.Request) {
	if !h.svc.IsAvailable() {
		writeJSON(w, map[string]interface{}{
			"entries": []interface{}{},
			"total":   0,
			"limit":   50,
			"offset":  0,
			"message": "pg_stat_statements not available — query history disabled",
		})
		return
	}

	params := map[string]string{
		"username":    r.URL.Query().Get("username"),
		"database":    r.URL.Query().Get("database"),
		"query_text":  r.URL.Query().Get("query_text"),
		"min_duration": r.URL.Query().Get("min_duration"),
		"status":      r.URL.Query().Get("status"),
		"from":        r.URL.Query().Get("from"),
		"to":          r.URL.Query().Get("to"),
		"order_by":    r.URL.Query().Get("order_by"),
		"order_dir":   r.URL.Query().Get("order_dir"),
		"limit":       r.URL.Query().Get("limit"),
		"offset":      r.URL.Query().Get("offset"),
	}

	result, err := h.svc.Search(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, result)
}

func (h *historyHandler) getByID(w http.ResponseWriter, r *http.Request) {
	if !h.svc.IsAvailable() {
		writeError(w, http.StatusServiceUnavailable, "query history not available")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	entry, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "entry not found")
		return
	}
	writeJSON(w, entry)
}

func (h *historyHandler) stats(w http.ResponseWriter, r *http.Request) {
	if !h.svc.IsAvailable() {
		writeJSON(w, map[string]interface{}{
			"total_entries": 0,
			"available":     false,
		})
		return
	}

	stats, err := h.svc.Stats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, stats)
}

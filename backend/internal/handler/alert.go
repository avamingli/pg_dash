package handler

import (
	"encoding/json"
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/alert"
	"github.com/go-chi/chi/v5"
)

func RegisterAlertRoutes(r chi.Router, engine *alert.Engine) {
	r.Get("/alerts", alertsListHandler(engine))
	r.Get("/alerts/active", alertsActiveHandler(engine))
	r.Get("/alerts/count", alertsCountHandler(engine))
	r.Get("/alerts/rules", alertsRulesHandler(engine))
	r.Put("/alerts/rules/{id}", alertsRuleUpdateHandler(engine))
}

func alertsListHandler(engine *alert.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		alerts := engine.GetAlerts()
		if alerts == nil {
			alerts = []alert.Alert{}
		}
		writeJSON(w, alerts)
	}
}

func alertsActiveHandler(engine *alert.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		alerts := engine.GetActiveAlerts()
		if alerts == nil {
			alerts = []alert.Alert{}
		}
		writeJSON(w, alerts)
	}
}

func alertsCountHandler(engine *alert.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]int{"count": engine.ActiveCount()})
	}
}

func alertsRulesHandler(engine *alert.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, engine.GetRules())
	}
}

func alertsRuleUpdateHandler(engine *alert.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if !engine.SetRuleEnabled(id, body.Enabled) {
			writeError(w, http.StatusNotFound, "rule not found")
			return
		}
		writeJSON(w, map[string]string{"status": "ok"})
	}
}

package handler

import (
	"net/http"

	"github.com/avamingli/dbhouse-web/backend/internal/alert"
	"github.com/go-chi/chi/v5"
)

func RegisterAlertRoutes(r chi.Router, engine *alert.Engine) {
	r.Get("/alerts", alertsListHandler(engine))
	r.Get("/alerts/active", alertsActiveHandler(engine))
	r.Get("/alerts/count", alertsCountHandler(engine))
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

package middleware

import (
	"net/http"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"
)

func ZerologLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		defer func() {
			log.Info().
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", ww.Status()).
				Dur("duration", time.Since(start)).
				Str("request_id", chimw.GetReqID(r.Context())).
				Msg("request")
		}()

		next.ServeHTTP(ww, r)
	})
}

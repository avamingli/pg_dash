package middleware

import (
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// JWTAuth returns middleware that verifies JWT tokens on requests.
// Skips /api/login and /api/health.
// For /ws, accepts token from query parameter (?token=...) as a fallback.
func JWTAuth(secret string) func(http.Handler) http.Handler {
	if secret == "" {
		secret = "pg-dash-default-secret"
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path

			// Skip auth for login and health
			if path == "/api/login" || path == "/api/health" {
				next.ServeHTTP(w, r)
				return
			}

			// For WebSocket: accept token from query param or skip if none
			if path == "/ws" {
				tokenString := r.URL.Query().Get("token")
				if tokenString == "" {
					// No token — allow connection (backward compat)
					next.ServeHTTP(w, r)
					return
				}
				// Validate the query-param token
				if validateToken(tokenString, secret) {
					next.ServeHTTP(w, r)
					return
				}
				http.Error(w, `{"code":401,"error":"invalid WebSocket token"}`, http.StatusUnauthorized)
				return
			}

			// Extract token from Authorization header
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"code":401,"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}

			tokenString := strings.TrimPrefix(authHeader, "Bearer ")
			if tokenString == authHeader {
				http.Error(w, `{"code":401,"error":"invalid authorization format"}`, http.StatusUnauthorized)
				return
			}

			if !validateToken(tokenString, secret) {
				http.Error(w, `{"code":401,"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func validateToken(tokenString, secret string) bool {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(secret), nil
	})
	return err == nil && token.Valid
}

package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/avamingli/dbhouse-web/backend/internal/config"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
}

func RegisterAuthRoutes(r chi.Router, cfg *config.Config) {
	r.Post("/login", loginHandler(cfg))
}

func loginHandler(cfg *config.Config) http.HandlerFunc {
	// Pre-hash the admin password for comparison
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)

	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		// Check username
		if req.Username != cfg.AdminUser {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}

		// Check password
		if err := bcrypt.CompareHashAndPassword(hashedPassword, []byte(req.Password)); err != nil {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}

		// Generate JWT
		expiresAt := time.Now().Add(24 * time.Hour)
		claims := jwt.MapClaims{
			"sub": req.Username,
			"exp": expiresAt.Unix(),
			"iat": time.Now().Unix(),
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		secret := cfg.JWTSecret
		if secret == "" {
			secret = "pg-dash-default-secret"
		}

		tokenString, err := token.SignedString([]byte(secret))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate token")
			return
		}

		writeJSON(w, loginResponse{
			Token:     tokenString,
			ExpiresAt: expiresAt.Unix(),
		})
	}
}

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-jwt-secret"

func makeToken(t *testing.T, secret string, exp time.Time) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub": "admin",
		"exp": exp.Unix(),
		"iat": time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func handler200() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
}

func TestJWTAuth_ValidToken(t *testing.T) {
	mw := JWTAuth(testSecret)
	token := makeToken(t, testSecret, time.Now().Add(time.Hour))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestJWTAuth_MissingHeader(t *testing.T) {
	mw := JWTAuth(testSecret)

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestJWTAuth_InvalidFormat(t *testing.T) {
	mw := JWTAuth(testSecret)

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Basic sometoken")
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestJWTAuth_ExpiredToken(t *testing.T) {
	mw := JWTAuth(testSecret)
	token := makeToken(t, testSecret, time.Now().Add(-time.Hour))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestJWTAuth_WrongSecret(t *testing.T) {
	mw := JWTAuth(testSecret)
	token := makeToken(t, "wrong-secret", time.Now().Add(time.Hour))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestJWTAuth_SkipsLogin(t *testing.T) {
	mw := JWTAuth(testSecret)

	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/login, got %d", w.Code)
	}
}

func TestJWTAuth_SkipsHealth(t *testing.T) {
	mw := JWTAuth(testSecret)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/health, got %d", w.Code)
	}
}

func TestJWTAuth_SkipsWebSocket(t *testing.T) {
	mw := JWTAuth(testSecret)

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /ws, got %d", w.Code)
	}
}

func TestJWTAuth_DefaultSecret(t *testing.T) {
	mw := JWTAuth("") // should use default secret
	token := makeToken(t, "pg-dash-default-secret", time.Now().Add(time.Hour))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	mw(handler200()).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

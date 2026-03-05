import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { api } from '@/lib/api';

interface AuthContextValue {
  token: string | null;
  user: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authRequired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  authRequired: false,
  login: async () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restore token & user from sessionStorage on mount (survives page refresh)
  const [token, setToken] = useState<string | null>(() => api.getToken());
  const [user, setUser] = useState<string | null>(() => api.getUser());
  const [isLoading, setIsLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);

  // Guard against re-entrant logout from concurrent 401 responses
  const logoutInProgress = useRef(false);

  // Detect whether auth is enabled via /api/health (never returns 401).
  // If we hold a stored token, verify it with an authenticated request;
  // if it's stale/invalid, clear it so the login page is shown.
  useEffect(() => {
    const controller = new AbortController();

    const checkAuth = async () => {
      try {
        // Step 1: ask the health endpoint whether auth is enabled
        const healthRes = await fetch(`${api.baseUrl}/api/health`, {
          signal: controller.signal,
        });
        const health = await healthRes.json();
        const authEnabled = health.auth_enabled === true;
        setAuthRequired(authEnabled);

        // Step 2: if auth is enabled and we have a stored token, verify it
        if (authEnabled && api.getToken()) {
          const verifyRes = await fetch(`${api.baseUrl}/api/server/info`, {
            headers: { 'Authorization': `Bearer ${api.getToken()}` },
            signal: controller.signal,
          });
          if (verifyRes.status === 401) {
            // Stored token is invalid/expired — clear it
            api.setToken(null);
            api.setUser(null);
            setToken(null);
            setUser(null);
          }
        }
      } catch (e) {
        // AbortError is expected on cleanup — don't update state
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setAuthRequired(false);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    checkAuth();

    return () => controller.abort();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${api.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || 'Invalid credentials');
    }

    const data: { token: string; expires_at: number } = await res.json();

    // Reset the guard so future 401s can trigger logout again
    logoutInProgress.current = false;

    // Write to both sessionStorage (via api helper) and React state
    api.setToken(data.token);
    api.setUser(username);
    setToken(data.token);
    setUser(username);
  }, []);

  const logout = useCallback(() => {
    api.setToken(null);
    api.setUser(null);
    setToken(null);
    setUser(null);
  }, []);

  // Auto-logout on 401 — only fires when we actually have a token.
  // Uses logoutInProgress ref to prevent cascading 401→logout loops
  // when multiple concurrent requests all fail at once.
  useEffect(() => {
    api.onUnauthorized(() => {
      if (logoutInProgress.current) return;   // already handling logout
      logoutInProgress.current = true;
      api.setToken(null);
      api.setUser(null);
      setToken(null);
      setUser(null);
    });
    return () => api.onUnauthorized(null);
  }, []);

  const isAuthenticated = !authRequired || token !== null;

  return (
    <AuthContext.Provider value={{ token, user, isAuthenticated, isLoading, authRequired, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

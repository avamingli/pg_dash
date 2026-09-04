import { createContext, useContext } from 'react';

/**
 * The optional-auth context. Auth is only active when the backend has
 * both ADMIN_USER and ADMIN_PASSWORD set (Config.AuthEnabled); with it
 * off, `authRequired` stays false and `isAuthenticated` is always true.
 *
 * The context object and its hook live here rather than beside the
 * provider because a component file that also exports non-components
 * breaks Fast Refresh. AuthContext.tsx holds the provider.
 */
export interface AuthContextValue {
  token: string | null;
  user: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authRequired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
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

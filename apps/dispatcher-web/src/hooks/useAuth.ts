'use client';
/**
 * useAuth hook — dispatcher web.
 *
 * Combines store state + API actions into a single, ergonomic interface.
 * Pages/screens use this hook; they never import from api/ directly.
 */
import { useAuthStore } from '../store/authStore';
import { loginV2 } from '../api/auth';
import { getApiErrorMessage } from '../api/client';

export function useAuth() {
  const { user, tokens, isLoading, error, setAuth, clearAuth, setLoading, setError, logout } =
    useAuthStore();

  async function login(email: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await loginV2(email, password);
      setAuth(data.user as any, { accessToken: data.accessToken, refreshToken: data.refreshToken });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Login failed'));
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return {
    user,
    tokens,
    isLoading,
    error,
    isAuthenticated: !!tokens,
    login,
    logout,
    clearError: () => setError(null),
  };
}

'use client';
/**
 * Auth state store — dispatcher web.
 *
 * Architecture rule: Store handles state. It may call api/ functions.
 * UI components never call api/ directly — they call store actions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, AuthTokens } from '../types/domain';
import { configureClient } from '../api/client';
import { refreshTokens, logout as logoutApi } from '../api/auth';

interface AuthStore {
  // State
  user:         User | null;
  tokens:       AuthTokens | null;
  isLoading:    boolean;
  error:        string | null;

  // Actions
  setAuth:      (user: User, tokens: AuthTokens) => void;
  clearAuth:    () => void;
  setLoading:   (loading: boolean) => void;
  setError:     (error: string | null) => void;
  logout:       () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user:      null,
      tokens:    null,
      isLoading: false,
      error:     null,

      setAuth: (user, tokens) => set({ user, tokens, error: null }),

      clearAuth: () => set({ user: null, tokens: null }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      logout: async () => {
        const { tokens } = get();
        if (tokens?.refreshToken) {
          try { await logoutApi(tokens.refreshToken); } catch { /* best-effort */ }
        }
        set({ user: null, tokens: null });
      },
    }),
    {
      name:    'teeneats-auth',
      // Only persist tokens + user, not transient state
      partialize: (state) => ({ user: state.user, tokens: state.tokens }),
    }
  )
);

// Configure the API client with the store's token getter once the module loads.
// This avoids circular imports while still injecting auth headers automatically.
if (typeof window !== 'undefined') {
  configureClient({
    getAccessToken: () => useAuthStore.getState().tokens?.accessToken ?? null,
    onRefreshFailed: () => useAuthStore.getState().clearAuth(),
  });
}

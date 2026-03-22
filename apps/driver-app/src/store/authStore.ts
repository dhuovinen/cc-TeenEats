/**
 * Auth state store — driver app (Zustand).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User, AuthTokens } from '../types/domain';
import { configureClient } from '../api/client';
import { logout as logoutApi } from '../api/auth';

interface AuthStore {
  user:      User | null;
  tokens:    AuthTokens | null;
  isLoading: boolean;
  error:     string | null;

  setAuth:    (user: User, tokens: AuthTokens) => void;
  clearAuth:  () => void;
  setLoading: (v: boolean) => void;
  setError:   (v: string | null) => void;
  logout:     () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user:      null,
      tokens:    null,
      isLoading: false,
      error:     null,

      setAuth:    (user, tokens) => set({ user, tokens, error: null }),
      clearAuth:  () => set({ user: null, tokens: null }),
      setLoading: (isLoading) => set({ isLoading }),
      setError:   (error) => set({ error }),

      logout: async () => {
        const { tokens } = get();
        if (tokens?.refreshToken) {
          try { await logoutApi(tokens.refreshToken); } catch { /* best-effort */ }
        }
        set({ user: null, tokens: null });
      },
    }),
    {
      name:       'teeneats-driver-auth',
      storage:    createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ user: s.user, tokens: s.tokens }),
    }
  )
);

// Configure API client once
configureClient({
  getAccessToken:  () => useAuthStore.getState().tokens?.accessToken ?? null,
  onRefreshFailed: () => useAuthStore.getState().clearAuth(),
});

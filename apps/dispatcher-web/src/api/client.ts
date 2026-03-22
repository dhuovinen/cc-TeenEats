/**
 * Base HTTP client for the dispatcher web.
 *
 * Architecture rule: ALL HTTP calls go through this file or files in src/api/.
 * Components never call fetch/axios directly.
 */
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Auth token injection ─────────────────────────────────────────────────────
// The interceptor reads from the store lazily to avoid a circular import.

let _getAccessToken: (() => string | null) | null = null;
let _onRefreshFailed: (() => void) | null = null;

export function configureClient(opts: {
  getAccessToken: () => string | null;
  onRefreshFailed: () => void;
}) {
  _getAccessToken = opts.getAccessToken;
  _onRefreshFailed = opts.onRefreshFailed;
}

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = _getAccessToken?.();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Dispatcher key header ────────────────────────────────────────────────────
// The dispatcher web also uses a shared API key for dispatcher-only routes.

export const dispatcherClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
    'x-dispatcher-key': process.env.NEXT_PUBLIC_DISPATCHER_API_KEY ?? '',
  },
});

// ─── Error helpers ────────────────────────────────────────────────────────────

export function isApiError(err: unknown): err is AxiosError<{ error: string }> {
  return axios.isAxiosError(err);
}

export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}

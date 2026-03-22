/**
 * Base HTTP client — driver app.
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

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

export function isApiError(err: unknown): err is import('axios').AxiosError<{ error: string }> {
  return axios.isAxiosError(err);
}

export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}

/**
 * Auth API calls — driver app.
 */
import { apiClient } from './client';
import type { User, AuthTokens } from '../types/domain';

export interface LoginResponse {
  accessToken:  string;
  refreshToken: string;
  user:         User & Record<string, unknown>;
}

export async function loginV2(email: string, password: string): Promise<LoginResponse> {
  const res = await apiClient.post<LoginResponse>('/auth/v2/login', { email, password });
  return res.data;
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const res = await apiClient.post<AuthTokens>('/auth/v2/refresh', { refreshToken });
  return res.data;
}

export async function logout(refreshToken: string) {
  await apiClient.post('/auth/v2/logout', { refreshToken });
}

export async function getMe(): Promise<{ user: User & Record<string, unknown> }> {
  const res = await apiClient.get('/auth/v2/me');
  return res.data;
}

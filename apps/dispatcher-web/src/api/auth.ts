/**
 * Auth API calls — dispatcher web.
 * All functions return typed responses; errors are thrown as-is for callers to handle.
 */
import { apiClient } from './client';
import type { User, AuthTokens } from '../types/domain';

export interface LoginResponse {
  accessToken:  string;
  refreshToken: string;
  user:         User & Record<string, unknown>;
}

export interface RegisterDriverPayload {
  email:         string;
  password:      string;
  full_name:     string;
  date_of_birth: string;   // YYYY-MM-DD
  state:         string;   // 2-letter
  city:          string;
  parent_email:  string;
}

export interface RegisterCustomerPayload {
  email:     string;
  password:  string;
  full_name: string;
}

export interface ConsentPayload {
  password:  string;
  full_name: string;
}

export async function loginV2(email: string, password: string): Promise<LoginResponse> {
  const res = await apiClient.post<LoginResponse>('/auth/v2/login', { email, password });
  return res.data;
}

export async function registerDriver(payload: RegisterDriverPayload) {
  const res = await apiClient.post('/auth/v2/register/driver', payload);
  return res.data;
}

export async function registerCustomer(payload: RegisterCustomerPayload) {
  const res = await apiClient.post('/auth/v2/register/customer', payload);
  return res.data;
}

export async function approveConsent(token: string, payload: ConsentPayload): Promise<LoginResponse> {
  const res = await apiClient.post<LoginResponse>(`/auth/v2/consent/${token}`, payload);
  return res.data;
}

export async function verifyEmail(token: string) {
  const res = await apiClient.post(`/auth/v2/verify-email/${token}`);
  return res.data;
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const res = await apiClient.post<AuthTokens>('/auth/v2/refresh', { refreshToken });
  return res.data;
}

export async function logout(refreshToken: string) {
  const res = await apiClient.post('/auth/v2/logout', { refreshToken });
  return res.data;
}

export async function getMe(): Promise<{ user: User & Record<string, unknown> }> {
  const res = await apiClient.get('/auth/v2/me');
  return res.data;
}

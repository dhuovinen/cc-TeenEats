import { Driver } from '../types';

// In-memory auth state for alpha (no persistent storage — driver must re-login after app restart)
let authToken: string | null = null;
let currentDriver: Driver | null = null;

export function setAuth(token: string, driver: Driver) {
  authToken = token;
  currentDriver = driver;
}

export function getToken(): string | null {
  return authToken;
}

export function getDriver(): Driver | null {
  return currentDriver;
}

export function clearAuth() {
  authToken = null;
  currentDriver = null;
}

export function isAuthenticated(): boolean {
  return authToken !== null;
}

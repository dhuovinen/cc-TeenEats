import { getToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body;
}

export async function login(email: string, password: string) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function setDriverStatus(driverId: string, status: 'online' | 'offline') {
  return apiFetch(`/drivers/${driverId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function acceptDelivery(deliveryId: string) {
  return apiFetch(`/deliveries/${deliveryId}/accept`, { method: 'POST' });
}

export async function completeDelivery(deliveryId: string) {
  return apiFetch(`/deliveries/${deliveryId}/complete`, { method: 'POST' });
}

export async function sendLocation(deliveryId: string, lat: number, lng: number) {
  return apiFetch(`/deliveries/${deliveryId}/location`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  });
}

export async function getScoreBreakdown(driverId: string) {
  return apiFetch(`/drivers/${driverId}/score`);
}

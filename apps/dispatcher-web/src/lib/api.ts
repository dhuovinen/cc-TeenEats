const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';
const DISPATCHER_KEY = process.env.NEXT_PUBLIC_DISPATCHER_API_KEY ?? '';

async function dispatcherFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-dispatcher-key': DISPATCHER_KEY,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchDrivers() {
  return dispatcherFetch('/drivers');
}

export async function fetchDeliveries() {
  return dispatcherFetch('/deliveries');
}

export async function fetchSettings() {
  return dispatcherFetch('/settings');
}

export async function updateSetting(key: string, value: string) {
  return dispatcherFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  });
}

export async function createDelivery(payload: {
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  item_description: string;
}) {
  return dispatcherFetch('/deliveries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function cancelDelivery(id: string) {
  return dispatcherFetch(`/deliveries/${id}/cancel`, { method: 'POST' });
}

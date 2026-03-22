/**
 * Deliveries API calls — driver app.
 */
import { apiClient } from './client';
import type { Delivery } from '../types/domain';

export async function acceptDelivery(deliveryId: string): Promise<{ delivery: Delivery }> {
  const res = await apiClient.post<{ delivery: Delivery }>(`/deliveries/${deliveryId}/accept`);
  return res.data;
}

export async function completeDelivery(deliveryId: string): Promise<{ delivery: Delivery }> {
  const res = await apiClient.post<{ delivery: Delivery }>(`/deliveries/${deliveryId}/complete`);
  return res.data;
}

export async function sendLocation(
  deliveryId: string,
  lat: number,
  lng: number
): Promise<{ ok: boolean }> {
  const res = await apiClient.post<{ ok: boolean }>(`/deliveries/${deliveryId}/location`, { lat, lng });
  return res.data;
}

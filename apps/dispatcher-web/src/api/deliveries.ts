/**
 * Deliveries API calls.
 */
import { dispatcherClient } from './client';
import type { Delivery } from '../types/domain';

export interface CreateDeliveryPayload {
  pickup_address:   string;
  pickup_lat:       number;
  pickup_lng:       number;
  dropoff_address:  string;
  dropoff_lat:      number;
  dropoff_lng:      number;
  item_description: string;
}

export async function listDeliveries(): Promise<{ deliveries: Delivery[] }> {
  const res = await dispatcherClient.get<{ deliveries: Delivery[] }>('/deliveries');
  return res.data;
}

export async function createDelivery(payload: CreateDeliveryPayload): Promise<{ delivery: Delivery }> {
  const res = await dispatcherClient.post<{ delivery: Delivery }>('/deliveries', payload);
  return res.data;
}

export async function cancelDelivery(deliveryId: string): Promise<{ delivery: Delivery }> {
  const res = await dispatcherClient.post<{ delivery: Delivery }>(`/deliveries/${deliveryId}/cancel`);
  return res.data;
}

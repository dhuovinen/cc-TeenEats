/**
 * Drivers API calls.
 */
import { dispatcherClient, apiClient } from './client';
import type { Driver, ScoreBreakdown, DriverStatus } from '../types/domain';

export async function listDrivers(): Promise<{ drivers: Driver[] }> {
  const res = await dispatcherClient.get<{ drivers: Driver[] }>('/drivers');
  return res.data;
}

export async function setDriverStatus(driverId: string, status: DriverStatus) {
  const res = await apiClient.patch(`/drivers/${driverId}/status`, { status });
  return res.data;
}

export async function getDriverScore(driverId: string): Promise<{ score: ScoreBreakdown }> {
  const res = await apiClient.get(`/drivers/${driverId}/score`);
  return res.data;
}

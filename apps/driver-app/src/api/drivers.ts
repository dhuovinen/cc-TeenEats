/**
 * Driver API calls — driver app.
 */
import { apiClient } from './client';
import type { DriverStatus, ScoreBreakdown } from '../types/domain';

export async function setStatus(driverId: string, status: DriverStatus) {
  const res = await apiClient.patch(`/drivers/${driverId}/status`, { status });
  return res.data;
}

export async function getScore(driverId: string): Promise<{ score: ScoreBreakdown }> {
  const res = await apiClient.get(`/drivers/${driverId}/score`);
  return res.data;
}

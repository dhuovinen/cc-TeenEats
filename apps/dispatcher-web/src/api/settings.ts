/**
 * Settings API calls.
 */
import { dispatcherClient } from './client';
import type { Settings } from '../types/domain';

export async function getSettings(): Promise<{ settings: Settings }> {
  const res = await dispatcherClient.get<{ settings: Settings }>('/settings');
  return res.data;
}

export async function updateSetting(key: string, value: string) {
  const res = await dispatcherClient.put('/settings', { key, value });
  return res.data;
}

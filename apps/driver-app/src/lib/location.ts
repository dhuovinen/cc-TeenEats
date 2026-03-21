/**
 * Foreground GPS tracking for active deliveries.
 *
 * LIMITATION (pre-MVP): Tracking requires the screen to stay on. If the driver
 * locks their phone, location updates will stop.
 * Post-MVP: Implement expo-location background task (expo-task-manager).
 */
import * as Location from 'expo-location';
import { sendLocation } from './api';

let locationSubscription: Location.LocationSubscription | null = null;

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function startLocationTracking(deliveryId: string): Promise<void> {
  stopLocationTracking();

  const hasPermission = await requestLocationPermission();
  if (!hasPermission) {
    console.warn('[location] permission denied');
    return;
  }

  locationSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,   // every 5 seconds
      distanceInterval: 10, // or 10 meters, whichever comes first
    },
    async (loc) => {
      try {
        await sendLocation(deliveryId, loc.coords.latitude, loc.coords.longitude);
      } catch (err) {
        console.warn('[location] send failed:', err);
      }
    }
  );
}

export function stopLocationTracking(): void {
  locationSubscription?.remove();
  locationSubscription = null;
}

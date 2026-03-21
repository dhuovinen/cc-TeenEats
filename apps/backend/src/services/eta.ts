/**
 * ETA estimation using straight-line (haversine) distance.
 *
 * LIMITATIONS (pre-MVP):
 * - Does not account for roads, traffic, or turns
 * - Assumes constant speed of 32 km/h (~20 mph) from pickup to dropoff
 * - ETA is fixed at delivery creation time and does not update
 * - Accuracy varies significantly by geography and road layout
 * Post-MVP: replace with Google Maps Directions API for real routing + dynamic updates.
 */
const ASSUMED_SPEED_KMH = 32; // ~20 mph

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function estimateMinutes(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): number {
  const distKm = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  return (distKm / ASSUMED_SPEED_KMH) * 60;
}

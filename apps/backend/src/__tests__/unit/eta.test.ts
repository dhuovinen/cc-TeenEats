import { haversineKm, estimateMinutes } from '../../services/eta';

describe('haversineKm', () => {
  test('zero distance — same coordinates', () => {
    expect(haversineKm(37.7749, -122.4194, 37.7749, -122.4194)).toBeCloseTo(0, 5);
  });

  test('symmetry — A→B equals B→A', () => {
    const ab = haversineKm(37.7749, -122.4194, 37.8044, -122.2712);
    const ba = haversineKm(37.8044, -122.2712, 37.7749, -122.4194);
    expect(ab).toBeCloseTo(ba, 5);
  });

  test('SF → Oakland (~13 km)', () => {
    // Approximate straight-line distance between downtown SF and downtown Oakland
    const km = haversineKm(37.7749, -122.4194, 37.8044, -122.2712);
    expect(km).toBeGreaterThan(12);
    expect(km).toBeLessThan(15);
  });

  test('short trip — roughly 1 km', () => {
    // ~1 km north on the same longitude
    const km = haversineKm(37.7749, -122.4194, 37.7839, -122.4194);
    expect(km).toBeGreaterThan(0.9);
    expect(km).toBeLessThan(1.1);
  });

  test('SF → LA (~559 km)', () => {
    const km = haversineKm(37.7749, -122.4194, 34.0522, -118.2437);
    expect(km).toBeGreaterThan(550);
    expect(km).toBeLessThan(570);
  });
});

describe('estimateMinutes', () => {
  test('zero distance returns 0', () => {
    expect(estimateMinutes(37.7749, -122.4194, 37.7749, -122.4194)).toBeCloseTo(0, 3);
  });

  test('SF → Oakland — expected ~24 min at 32 km/h', () => {
    const mins = estimateMinutes(37.7749, -122.4194, 37.8044, -122.2712);
    // 13 km / 32 km/h * 60 ≈ 24.4 min
    expect(mins).toBeGreaterThan(22);
    expect(mins).toBeLessThan(28);
  });

  test('very short trip — less than 2 minutes', () => {
    const mins = estimateMinutes(37.7749, -122.4194, 37.7758, -122.4185);
    expect(mins).toBeLessThan(2);
  });

  test('result is always non-negative', () => {
    const mins = estimateMinutes(0, 0, 0.001, 0.001);
    expect(mins).toBeGreaterThanOrEqual(0);
  });
});

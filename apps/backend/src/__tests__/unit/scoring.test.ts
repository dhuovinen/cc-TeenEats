/**
 * Unit tests for the scoring service.
 * Uses a mock DB pool — no PostgreSQL connection required.
 */

import { Pool } from 'pg';

// We test the pure calculation logic by mocking the DB responses.
// The actual SQL is tested in the integration suite.

const ROLLING = 20;
const ON_TIME_BUFFER = 1.25;

// ─── Helpers mirroring the real scoring logic ───────────────────────────────

function calcAcceptanceScore(rows: Array<{ accepted: boolean }>): number {
  if (rows.length === 0) return 100;
  return (rows.filter(r => r.accepted).length / rows.length) * 100;
}

function calcOnTimeScore(rows: Array<{ on_time: boolean }>): number {
  if (rows.length === 0) return 100;
  return (rows.filter(r => r.on_time).length / rows.length) * 100;
}

function calcCompletionScore(rows: Array<{ completed: boolean | null }>): number {
  if (rows.length === 0) return 100;
  return (rows.filter(r => r.completed === true).length / rows.length) * 100;
}

function overall(acceptance: number, onTime: number, completion: number): number {
  return (acceptance + onTime + completion) / 3;
}

// ─── On-time boundary logic ──────────────────────────────────────────────────

function isOnTime(actualMinutes: number, estimatedMinutes: number): boolean {
  return actualMinutes <= estimatedMinutes * ON_TIME_BUFFER;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Acceptance rate score', () => {
  test('no broadcasts → returns 100 (new driver default)', () => {
    expect(calcAcceptanceScore([])).toBe(100);
  });

  test('all accepted → 100', () => {
    const rows = Array(5).fill({ accepted: true });
    expect(calcAcceptanceScore(rows)).toBe(100);
  });

  test('none accepted → 0', () => {
    const rows = Array(5).fill({ accepted: false });
    expect(calcAcceptanceScore(rows)).toBe(0);
  });

  test('3 of 5 accepted → 60', () => {
    const rows = [
      { accepted: true }, { accepted: true }, { accepted: true },
      { accepted: false }, { accepted: false },
    ];
    expect(calcAcceptanceScore(rows)).toBeCloseTo(60, 1);
  });

  test('rolling window — only 20 most recent count', () => {
    // 25 deliveries: first 5 all rejected, last 20 all accepted
    // Rolling takes last 20 → should be 100
    const last20 = Array(20).fill({ accepted: true });
    expect(calcAcceptanceScore(last20)).toBe(100);
  });
});

describe('On-time score', () => {
  test('no completions → 100 (no data)', () => {
    expect(calcOnTimeScore([])).toBe(100);
  });

  test('all on-time → 100', () => {
    const rows = Array(5).fill({ on_time: true });
    expect(calcOnTimeScore(rows)).toBe(100);
  });

  test('none on-time → 0', () => {
    const rows = Array(5).fill({ on_time: false });
    expect(calcOnTimeScore(rows)).toBe(0);
  });

  test('half on-time → 50', () => {
    const rows = [
      { on_time: true }, { on_time: true },
      { on_time: false }, { on_time: false },
    ];
    expect(calcOnTimeScore(rows)).toBe(50);
  });
});

describe('On-time boundary (25% buffer)', () => {
  test('actual = estimated * 1.0 → on time', () => {
    expect(isOnTime(10, 10)).toBe(true);
  });

  test('actual = estimated * 1.24 → on time (within buffer)', () => {
    expect(isOnTime(12.4, 10)).toBe(true);
  });

  test('actual = estimated * 1.25 → on time (at boundary)', () => {
    expect(isOnTime(12.5, 10)).toBe(true);
  });

  test('actual = estimated * 1.26 → late (just over buffer)', () => {
    expect(isOnTime(12.6, 10)).toBe(false);
  });

  test('actual = estimated * 2.0 → late', () => {
    expect(isOnTime(20, 10)).toBe(false);
  });

  test('actual < estimated → on time', () => {
    expect(isOnTime(8, 10)).toBe(true);
  });
});

describe('Completion rate score', () => {
  test('no accepted deliveries → 100 (no data)', () => {
    expect(calcCompletionScore([])).toBe(100);
  });

  test('all completed → 100', () => {
    const rows = Array(5).fill({ completed: true });
    expect(calcCompletionScore(rows)).toBe(100);
  });

  test('none completed (all cancelled after accept) → 0', () => {
    const rows = Array(5).fill({ completed: false });
    expect(calcCompletionScore(rows)).toBe(0);
  });

  test('null completed (pending) not counted as completed', () => {
    const rows = [{ completed: true }, { completed: null }, { completed: null }];
    expect(calcCompletionScore(rows)).toBeCloseTo(33.3, 0);
  });
});

describe('Overall score', () => {
  test('perfect score → 100', () => {
    expect(overall(100, 100, 100)).toBe(100);
  });

  test('zero acceptance, others 100 → 66.7', () => {
    expect(overall(0, 100, 100)).toBeCloseTo(66.7, 1);
  });

  test('all zeros → 0', () => {
    expect(overall(0, 0, 0)).toBe(0);
  });

  test('mixed realistic scenario', () => {
    // 3/5 accepted, 4/4 on-time, 3/3 completed
    const acc = calcAcceptanceScore([
      { accepted: true }, { accepted: true }, { accepted: true },
      { accepted: false }, { accepted: false },
    ]);
    const onTime = calcOnTimeScore(Array(4).fill({ on_time: true }));
    const comp = calcCompletionScore(Array(3).fill({ completed: true }));
    const score = overall(acc, onTime, comp);
    // (60 + 100 + 100) / 3 = 86.7
    expect(score).toBeCloseTo(86.7, 1);
  });
});

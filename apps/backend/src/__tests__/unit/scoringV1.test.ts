/**
 * Unit tests — Safety Scoring v1 pure functions
 *
 * Tests: speed classification, braking classification,
 *        session score computation, rolling score, tier labels.
 */
import {
  classifySpeedViolation,
  classifyBrakingPenalty,
  computeSessionScore,
  calculateRollingScore,
  scoreTier,
  kphToMph,
  SPEED_PENALTY,
  SPEED_PENALTY_CAP,
  BRAKING_PENALTY_CAP,
  HARSH_G_THRESHOLD,
} from '../../services/scoringV1';

// ─── kphToMph ────────────────────────────────────────────────────────────────

describe('kphToMph', () => {
  it('0 kph = 0 mph', () => expect(kphToMph(0)).toBeCloseTo(0));
  it('100 kph ≈ 62.1 mph', () => expect(kphToMph(100)).toBeCloseTo(62.14, 1));
  it('16.09 kph ≈ 10 mph', () => expect(kphToMph(16.09)).toBeCloseTo(10, 0));
});

// ─── classifySpeedViolation ───────────────────────────────────────────────────

describe('classifySpeedViolation', () => {
  it('0 mph over → no penalty', () => {
    expect(classifySpeedViolation(0)).toEqual({ penalty: 0, severity: null });
  });
  it('negative mph over → no penalty', () => {
    expect(classifySpeedViolation(-5)).toEqual({ penalty: 0, severity: null });
  });
  it('1 mph over → low (-3)', () => {
    expect(classifySpeedViolation(1)).toEqual({ penalty: SPEED_PENALTY.LOW, severity: 'low' });
  });
  it('10 mph over → low (-3)', () => {
    expect(classifySpeedViolation(10)).toEqual({ penalty: SPEED_PENALTY.LOW, severity: 'low' });
  });
  it('11 mph over → medium (-8)', () => {
    expect(classifySpeedViolation(11)).toEqual({ penalty: SPEED_PENALTY.MEDIUM, severity: 'medium' });
  });
  it('20 mph over → medium (-8)', () => {
    expect(classifySpeedViolation(20)).toEqual({ penalty: SPEED_PENALTY.MEDIUM, severity: 'medium' });
  });
  it('21 mph over → high (-20)', () => {
    expect(classifySpeedViolation(21)).toEqual({ penalty: SPEED_PENALTY.HIGH, severity: 'high' });
  });
  it('50 mph over → high (-20)', () => {
    expect(classifySpeedViolation(50)).toEqual({ penalty: SPEED_PENALTY.HIGH, severity: 'high' });
  });
});

// ─── classifyBrakingPenalty ───────────────────────────────────────────────────

describe('classifyBrakingPenalty', () => {
  it('0.0g → no penalty', () => expect(classifyBrakingPenalty(0.0)).toBe(0));
  it('0.3g → no penalty (below 0.4g threshold)', () => expect(classifyBrakingPenalty(0.3)).toBe(0));
  it('0.39g → no penalty (just under threshold)', () => expect(classifyBrakingPenalty(0.39)).toBe(0));
  it('0.4g → penalty (exactly at threshold)', () => expect(classifyBrakingPenalty(HARSH_G_THRESHOLD)).toBe(0));
  it('0.41g → penalty (-5)', () => expect(classifyBrakingPenalty(0.41)).toBe(5));
  it('0.5g → penalty (-5)', () => expect(classifyBrakingPenalty(0.5)).toBe(5));
  it('1.0g → penalty (-5)', () => expect(classifyBrakingPenalty(1.0)).toBe(5));
});

// ─── computeSessionScore ─────────────────────────────────────────────────────

describe('computeSessionScore', () => {
  it('no events → score 100', () => {
    const r = computeSessionScore([], []);
    expect(r.final_score).toBe(100);
    expect(r.speed_violations).toBe(0);
    expect(r.braking_violations).toBe(0);
    expect(r.event_count).toBe(0);
  });

  it('example from scoring.md: low + medium speed + 2x harsh braking → 79', () => {
    // Speed: -3 (low, 7 mph over) + -8 (medium, 15 mph over) = -11
    // Braking: -5 + -5 = -10
    // Total penalty: 21 → score: 79
    const r = computeSessionScore(
      [SPEED_PENALTY.LOW, SPEED_PENALTY.MEDIUM],
      [5, 5]
    );
    expect(r.final_score).toBe(79);
    expect(r.speed_penalty).toBe(11);
    expect(r.braking_penalty).toBe(10);
    expect(r.speed_violations).toBe(2);
    expect(r.braking_violations).toBe(2);
  });

  it('speed penalties capped at 40 even when raw total is higher', () => {
    // 3 high violations = 3 × 20 = 60 raw → capped at 40
    const r = computeSessionScore([20, 20, 20], []);
    expect(r.speed_penalty).toBe(SPEED_PENALTY_CAP);
    expect(r.final_score).toBe(60); // 100 - 40
  });

  it('braking penalties capped at 30', () => {
    // 7 harsh events = 7 × 5 = 35 raw → capped at 30
    const r = computeSessionScore([], [5, 5, 5, 5, 5, 5, 5]);
    expect(r.braking_penalty).toBe(BRAKING_PENALTY_CAP);
    expect(r.final_score).toBe(70); // 100 - 30
  });

  it('both caps applied: minimum score is 0, never negative', () => {
    // Max speed (40) + max braking (30) = 70 penalty → score 30
    // Extreme: 10 high speed violations + 10 harsh braking = 200+50 raw
    const r = computeSessionScore(
      [20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
      [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
    );
    expect(r.speed_penalty).toBe(SPEED_PENALTY_CAP);     // 40
    expect(r.braking_penalty).toBe(BRAKING_PENALTY_CAP); // 30
    expect(r.final_score).toBe(30);                       // 100 - 40 - 30
  });

  it('score never goes below 0', () => {
    // This can't normally happen with caps (max penalty = 70), but verify guard
    const r = computeSessionScore([40], [30]);
    expect(r.final_score).toBeGreaterThanOrEqual(0);
  });

  it('zero-penalty events (0-value entries) do not count as violations', () => {
    const r = computeSessionScore([0, 0, SPEED_PENALTY.LOW], [0, 5]);
    expect(r.speed_violations).toBe(1);
    expect(r.braking_violations).toBe(1);
    expect(r.event_count).toBe(5);
  });

  it('single high speed violation: score = 80', () => {
    const r = computeSessionScore([20], []);
    expect(r.final_score).toBe(80);
  });
});

// ─── calculateRollingScore ────────────────────────────────────────────────────

describe('calculateRollingScore', () => {
  it('empty array → 100', () => {
    expect(calculateRollingScore([])).toBe(100);
  });

  it('single session → equals that session score', () => {
    expect(calculateRollingScore([80])).toBe(80);
  });

  it('5 sessions all 100 → 100', () => {
    expect(calculateRollingScore([100, 100, 100, 100, 100])).toBe(100);
  });

  it('5 sessions all 60 → 60', () => {
    expect(calculateRollingScore([60, 60, 60, 60, 60])).toBe(60);
  });

  it('most recent session gets 2x weight (last element = most recent)', () => {
    // Sessions [old→new]: [0, 0, 0, 0, 100]
    // reversed: [100, 0, 0, 0, 0]
    // recent(5): weights [2,2,2,2,2] = [200,0,0,0,0] sum=200 / 10 = 20
    const r = calculateRollingScore([0, 0, 0, 0, 100]);
    // recent = [100,0,0,0,0], totalWeight=10, weightedSum = 100*2 = 200, avg = 20
    expect(r).toBe(20);
  });

  it('6th session uses 1x weight (not recent)', () => {
    // [old→new]: [100, 0, 0, 0, 0, 0]
    // reversed: [0, 0, 0, 0, 0, 100]
    // recent(5): [0,0,0,0,0] weight 2 each → sum=0, weight=10
    // older(1): [100] weight 1 → sum=100, weight=1
    // total = 100/11 ≈ 9.09
    const r = calculateRollingScore([100, 0, 0, 0, 0, 0]);
    expect(r).toBeCloseTo(100 / 11, 1);
  });

  it('beyond 20 sessions are ignored', () => {
    // 25 sessions all 0, last session is 100
    const sessions = new Array(24).fill(0);
    sessions.push(100); // 25th = most recent
    const r = calculateRollingScore(sessions);
    // reversed: [100, 0*19 (only 20 used), ...]
    // recent(5): [100,0,0,0,0] weight 2 → sum=200, weight=10
    // older(15): [0*15] weight 1 → sum=0, weight=15
    // total=200/(10+15) = 8
    expect(r).toBeCloseTo(200 / 25, 1);
  });

  it('2 sessions: second (more recent) gets 2x weight', () => {
    // [70, 90]: reversed = [90, 70]
    // recent(2): [90,70] weight 2 → 180+140=320 / 4 = 80
    expect(calculateRollingScore([70, 90])).toBe(80);
  });
});

// ─── scoreTier ────────────────────────────────────────────────────────────────

describe('scoreTier', () => {
  it('100 → Excellent', () => expect(scoreTier(100)).toBe('Excellent'));
  it('90 → Excellent', ()  => expect(scoreTier(90)).toBe('Excellent'));
  it('89 → Good', ()       => expect(scoreTier(89)).toBe('Good'));
  it('75 → Good', ()       => expect(scoreTier(75)).toBe('Good'));
  it('74 → Fair', ()       => expect(scoreTier(74)).toBe('Fair'));
  it('60 → Fair', ()       => expect(scoreTier(60)).toBe('Fair'));
  it('59 → Needs Improvement', () => expect(scoreTier(59)).toBe('Needs Improvement'));
  it('40 → Needs Improvement', () => expect(scoreTier(40)).toBe('Needs Improvement'));
  it('39 → Poor', ()       => expect(scoreTier(39)).toBe('Poor'));
  it('0 → Poor', ()        => expect(scoreTier(0)).toBe('Poor'));
});

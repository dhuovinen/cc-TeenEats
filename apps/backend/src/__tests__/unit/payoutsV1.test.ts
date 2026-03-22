/**
 * Unit tests — Payouts v1 pure functions
 *
 * Tests: calculateBonusPct, calculateSessionEarnings, formatCents
 */
import {
  calculateBonusPct,
  calculateSessionEarnings,
  formatCents,
  BASE_SPLIT,
  BONUS_SPLIT,
  DEFAULT_DELIVERY_FEE_CENTS,
} from '../../services/payoutsV1';

// ─── constants sanity ─────────────────────────────────────────────────────────

describe('constants', () => {
  it('BASE_SPLIT + BONUS_SPLIT = 1.0', () => {
    expect(BASE_SPLIT + BONUS_SPLIT).toBeCloseTo(1.0);
  });
  it('DEFAULT_DELIVERY_FEE_CENTS = 800', () => {
    expect(DEFAULT_DELIVERY_FEE_CENTS).toBe(800);
  });
});

// ─── calculateBonusPct ────────────────────────────────────────────────────────

describe('calculateBonusPct', () => {
  it('score 100 → 1.0',  () => expect(calculateBonusPct(100)).toBe(1.0));
  it('score 0   → 0.0',  () => expect(calculateBonusPct(0)).toBe(0.0));
  it('score 50  → 0.50', () => expect(calculateBonusPct(50)).toBe(0.5));
  it('score 82  → 0.82', () => expect(calculateBonusPct(82)).toBe(0.82));
  it('score 75  → 0.75', () => expect(calculateBonusPct(75)).toBe(0.75));
  it('negative score clamped to 0', () => expect(calculateBonusPct(-10)).toBe(0.0));
  it('score > 100 clamped to 1.0',  () => expect(calculateBonusPct(110)).toBe(1.0));
  it('score 33  → 0.33', () => expect(calculateBonusPct(33)).toBe(0.33));
});

// ─── calculateSessionEarnings ─────────────────────────────────────────────────

describe('calculateSessionEarnings', () => {
  describe('$8.00 delivery fee (800 cents)', () => {
    const FEE = 800;

    it('score 100: driver earns full fee ($8.00), platform earns $0.00', () => {
      const r = calculateSessionEarnings(FEE, 100);
      expect(r.base_pay_cents).toBe(560);      // 800 * 0.70
      expect(r.max_bonus_cents).toBe(240);     // 800 - 560
      expect(r.bonus_pay_cents).toBe(240);     // 240 * 1.0
      expect(r.driver_pay_cents).toBe(800);    // full fee
      expect(r.platform_cut_cents).toBe(0);
    });

    it('score 0: driver earns base only ($5.60), platform earns max bonus ($2.40)', () => {
      const r = calculateSessionEarnings(FEE, 0);
      expect(r.base_pay_cents).toBe(560);
      expect(r.bonus_pay_cents).toBe(0);
      expect(r.driver_pay_cents).toBe(560);
      expect(r.platform_cut_cents).toBe(240);
    });

    it('score 82: matches scoring.md example — driver $7.57, platform $0.43', () => {
      // Example from docs/scoring.md:
      // base = 560, max_bonus = 240, bonus = 240*0.82 = 196.8 → round = 197
      // driver = 560+197 = 757, platform = 800-757 = 43
      const r = calculateSessionEarnings(FEE, 82);
      expect(r.base_pay_cents).toBe(560);
      expect(r.bonus_pay_cents).toBe(197);     // round(240 * 0.82) = round(196.8)
      expect(r.driver_pay_cents).toBe(757);
      expect(r.platform_cut_cents).toBe(43);
    });

    it('score 70: driver $7.28, platform $0.72', () => {
      // bonus = round(240 * 0.70) = round(168) = 168
      // driver = 560+168 = 728, platform = 72
      const r = calculateSessionEarnings(FEE, 70);
      expect(r.driver_pay_cents).toBe(728);
      expect(r.platform_cut_cents).toBe(72);
    });

    it('score 50: driver $6.80, platform $1.20', () => {
      // bonus = round(240 * 0.50) = 120
      // driver = 560+120 = 680
      const r = calculateSessionEarnings(FEE, 50);
      expect(r.driver_pay_cents).toBe(680);
      expect(r.platform_cut_cents).toBe(120);
    });

    it('delivery_fee_cents and rolling_score_used are echoed back', () => {
      const r = calculateSessionEarnings(FEE, 82);
      expect(r.delivery_fee_cents).toBe(FEE);
      expect(r.rolling_score_used).toBe(82);
      expect(r.bonus_pct).toBe(0.82);
    });
  });

  describe('fee invariants', () => {
    it('driver_pay + platform_cut always equals delivery_fee', () => {
      for (const score of [0, 33, 50, 70, 82, 90, 100]) {
        const r = calculateSessionEarnings(800, score);
        expect(r.driver_pay_cents + r.platform_cut_cents).toBe(800);
      }
    });

    it('different fee ($12.00 = 1200 cents), score 100: driver earns full 1200', () => {
      const r = calculateSessionEarnings(1200, 100);
      expect(r.driver_pay_cents).toBe(1200);
      expect(r.platform_cut_cents).toBe(0);
    });

    it('different fee ($12.00), score 0: driver earns only base (840)', () => {
      // base = round(1200 * 0.70) = 840
      const r = calculateSessionEarnings(1200, 0);
      expect(r.base_pay_cents).toBe(840);
      expect(r.driver_pay_cents).toBe(840);
    });

    it('driver always earns at least base (70% floor guaranteed)', () => {
      for (const score of [0, 1, 10, 50, 99, 100]) {
        const r = calculateSessionEarnings(800, score);
        expect(r.driver_pay_cents).toBeGreaterThanOrEqual(r.base_pay_cents);
      }
    });

    it('bonus_pay never exceeds max_bonus', () => {
      for (const score of [0, 50, 99, 100]) {
        const r = calculateSessionEarnings(800, score);
        expect(r.bonus_pay_cents).toBeLessThanOrEqual(r.max_bonus_cents);
      }
    });
  });
});

// ─── formatCents ─────────────────────────────────────────────────────────────

describe('formatCents', () => {
  it('0 → "$0.00"',   () => expect(formatCents(0)).toBe('$0.00'));
  it('800 → "$8.00"', () => expect(formatCents(800)).toBe('$8.00'));
  it('757 → "$7.57"', () => expect(formatCents(757)).toBe('$7.57'));
  it('1 → "$0.01"',   () => expect(formatCents(1)).toBe('$0.01'));
  it('1000 → "$10.00"', () => expect(formatCents(1000)).toBe('$10.00'));
  it('1234 → "$12.34"', () => expect(formatCents(1234)).toBe('$12.34'));
});

/**
 * Payouts v1 — 70/30 split with rolling-score bonus
 *
 * Pure functions (unit-testable without DB):
 *   calculateSessionEarnings  — compute cents breakdown for one session
 *   calculateBonusPct          — rolling score (0–100) → bonus fraction (0–1)
 *   formatCents                — cents → "$X.XX" display string
 *
 * DB-backed functions:
 *   computeAndSaveSessionEarnings — pull rolling score + save to session_earnings
 *   triggerPayoutForDriver         — aggregate pending earnings → create payout row
 *   markPayoutPaid                 — set payout to paid + optional stripe transfer id
 */

import { db } from '../db';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BASE_SPLIT = 0.70;       // 70% base pay fraction
export const BONUS_SPLIT = 0.30;      // 30% max bonus fraction
export const DEFAULT_DELIVERY_FEE_CENTS = 800; // $8.00

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionEarningsResult {
  delivery_fee_cents: number;
  rolling_score_used: number;
  base_pay_cents: number;
  max_bonus_cents: number;
  bonus_pay_cents: number;
  driver_pay_cents: number;
  platform_cut_cents: number;
  bonus_pct: number;
}

// ─── Pure Functions ───────────────────────────────────────────────────────────

/**
 * Map rolling score (0–100) to bonus fraction (0.0–1.0, two decimal precision).
 * Linear: score 100 → 1.0, score 0 → 0.0
 */
export function calculateBonusPct(rollingScore: number): number {
  const clamped = Math.max(0, Math.min(100, rollingScore));
  return Math.round((clamped / 100) * 100) / 100;
}

/**
 * Compute per-session earnings breakdown.
 *
 * base_pay   = delivery_fee * 0.70                    (always paid)
 * max_bonus  = delivery_fee * 0.30
 * bonus_pay  = max_bonus   * (rollingScore / 100)     (scales with score)
 * driver_pay = base_pay + bonus_pay
 *
 * All values are in cents, rounded to nearest cent.
 */
export function calculateSessionEarnings(
  deliveryFeeCents: number,
  rollingScore: number,
): SessionEarningsResult {
  const basePay = Math.round(deliveryFeeCents * BASE_SPLIT);
  const maxBonus = deliveryFeeCents - basePay; // avoids rounding gap
  const bonusPct = calculateBonusPct(rollingScore);
  const bonusPay = Math.round(maxBonus * bonusPct);
  const driverPay = basePay + bonusPay;
  const platformCut = deliveryFeeCents - driverPay;

  return {
    delivery_fee_cents: deliveryFeeCents,
    rolling_score_used: rollingScore,
    base_pay_cents: basePay,
    max_bonus_cents: maxBonus,
    bonus_pay_cents: bonusPay,
    driver_pay_cents: driverPay,
    platform_cut_cents: platformCut,
    bonus_pct: bonusPct,
  };
}

/**
 * Format cents as a display string. e.g. 757 → "$7.57"
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── DB-Backed Functions ──────────────────────────────────────────────────────

/**
 * Compute earnings for a completed session and persist to session_earnings.
 * Uses UPSERT so re-runs are idempotent (admin can recalculate).
 * Called async after order deliver — errors are logged, not thrown to caller.
 */
export async function computeAndSaveSessionEarnings(sessionId: string): Promise<void> {
  // Fetch session info: driver, delivery_fee_cents
  const { rows: [session] } = await db.query<{
    driver_id: string;
    delivery_fee_cents: number;
  }>(
    `SELECT driver_id, delivery_fee_cents FROM delivery_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  // Get driver's current rolling score (from score_history, falls back to 100)
  const { rows: [scoreRow] } = await db.query<{ weighted_avg: string }>(
    `SELECT weighted_avg FROM score_history
     WHERE driver_id = $1
     ORDER BY computed_at DESC LIMIT 1`,
    [session.driver_id],
  );
  const rollingScore = scoreRow ? parseFloat(scoreRow.weighted_avg) : 100;

  const e = calculateSessionEarnings(session.delivery_fee_cents, rollingScore);

  await db.query(
    `INSERT INTO session_earnings
       (session_id, driver_id, delivery_fee_cents, rolling_score_used,
        base_pay_cents, bonus_pay_cents, driver_pay_cents, platform_cut_cents, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
     ON CONFLICT (session_id) DO UPDATE SET
       delivery_fee_cents  = EXCLUDED.delivery_fee_cents,
       rolling_score_used  = EXCLUDED.rolling_score_used,
       base_pay_cents      = EXCLUDED.base_pay_cents,
       bonus_pay_cents     = EXCLUDED.bonus_pay_cents,
       driver_pay_cents    = EXCLUDED.driver_pay_cents,
       platform_cut_cents  = EXCLUDED.platform_cut_cents,
       calculated_at       = NOW()`,
    [
      sessionId,
      session.driver_id,
      e.delivery_fee_cents,
      e.rolling_score_used,
      e.base_pay_cents,
      e.bonus_pay_cents,
      e.driver_pay_cents,
      e.platform_cut_cents,
    ],
  );
}

/**
 * Aggregate all pending session_earnings for a driver into a payout record.
 * Returns the created payout id, or null if no pending earnings found.
 */
export async function triggerPayoutForDriver(
  driverId: string,
  periodStart: string, // ISO date string 'YYYY-MM-DD'
  periodEnd: string,
): Promise<string | null> {
  // Sum pending earnings in the given period
  const { rows: [agg] } = await db.query<{
    sessions_count: string;
    total_cents: string;
  }>(
    `SELECT COUNT(*) AS sessions_count, COALESCE(SUM(driver_pay_cents),0) AS total_cents
     FROM session_earnings se
     JOIN delivery_sessions ds ON ds.id = se.session_id
     WHERE se.driver_id = $1
       AND se.status    = 'pending'
       AND ds.completed_at::date BETWEEN $2 AND $3`,
    [driverId, periodStart, periodEnd],
  );

  const sessionsCount = parseInt(agg.sessions_count, 10);
  if (sessionsCount === 0) return null;

  const totalCents = parseInt(agg.total_cents, 10);

  const { rows: [payout] } = await db.query<{ id: string }>(
    `INSERT INTO payouts (driver_id, period_start, period_end, sessions_count, total_cents, status)
     VALUES ($1,$2,$3,$4,$5,'pending')
     RETURNING id`,
    [driverId, periodStart, periodEnd, sessionsCount, totalCents],
  );

  // Link session_earnings → payout and mark as paid
  await db.query(
    `UPDATE session_earnings se
     SET payout_id = $1, status = 'paid'
     FROM delivery_sessions ds
     WHERE se.session_id = ds.id
       AND se.driver_id  = $2
       AND se.status     = 'pending'
       AND ds.completed_at::date BETWEEN $3 AND $4`,
    [payout.id, driverId, periodStart, periodEnd],
  );

  return payout.id;
}

/**
 * Mark a payout as paid (e.g. after Stripe transfer confirms).
 */
export async function markPayoutPaid(
  payoutId: string,
  stripeTransferId?: string,
): Promise<void> {
  await db.query(
    `UPDATE payouts
     SET status = 'paid', stripe_transfer_id = $2, paid_at = NOW()
     WHERE id = $1`,
    [payoutId, stripeTransferId ?? null],
  );
}

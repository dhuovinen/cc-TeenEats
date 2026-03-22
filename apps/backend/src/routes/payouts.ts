/**
 * Payouts + Earnings routes
 *
 * Driver (JWT required):
 *   GET  /payouts/me/earnings          — own session earnings history
 *   GET  /payouts/me/payouts           — own payout history
 *
 * Admin:
 *   POST /payouts/sessions/:session_id/calculate  — (re)compute session earnings
 *   GET  /payouts/drivers/:driver_id/earnings     — any driver's earnings
 *   GET  /payouts/drivers/:driver_id/payouts      — any driver's payouts
 *   POST /payouts/trigger                          — create payout for driver(s)
 *   POST /payouts/:payout_id/mark-paid            — mark payout paid
 */

import { Router, Request, Response } from 'express';
import { requireAuthV2, requireRole } from '../middleware/authV2';
import { db } from '../db';
import {
  computeAndSaveSessionEarnings,
  triggerPayoutForDriver,
  markPayoutPaid,
} from '../services/payoutsV1';

const router = Router();

// ─── Driver: own earnings ─────────────────────────────────────────────────────

router.get('/me/earnings', requireAuthV2, async (req: Request, res: Response) => {
  const driver_id = req.userId!;

  const { rows } = await db.query(
    `SELECT
       se.session_id,
       se.delivery_fee_cents,
       se.rolling_score_used,
       se.base_pay_cents,
       se.bonus_pay_cents,
       se.driver_pay_cents,
       se.platform_cut_cents,
       se.status,
       se.payout_id,
       se.calculated_at,
       ds.completed_at AS session_completed_at
     FROM session_earnings se
     JOIN delivery_sessions ds ON ds.id = se.session_id
     WHERE se.driver_id = $1
     ORDER BY se.calculated_at DESC
     LIMIT 50`,
    [driver_id],
  );

  res.json({ earnings: rows });
});

router.get('/me/payouts', requireAuthV2, async (req: Request, res: Response) => {
  const driver_id = req.userId!;

  const { rows } = await db.query(
    `SELECT id, period_start, period_end, sessions_count, total_cents, status,
            stripe_transfer_id, initiated_at, paid_at
     FROM payouts
     WHERE driver_id = $1
     ORDER BY initiated_at DESC
     LIMIT 24`,
    [driver_id],
  );

  res.json({ payouts: rows });
});

// ─── Admin: (re)compute session earnings ─────────────────────────────────────

router.post(
  '/sessions/:session_id/calculate',
  requireAuthV2, requireRole('admin'),
  async (req: Request, res: Response) => {
    const { session_id } = req.params;

    // Verify session exists
    const { rows } = await db.query(
      `SELECT id FROM delivery_sessions WHERE id = $1`,
      [session_id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    await computeAndSaveSessionEarnings(session_id);

    const { rows: [earning] } = await db.query(
      `SELECT * FROM session_earnings WHERE session_id = $1`,
      [session_id],
    );

    res.json({ earning });
  },
);

// ─── Admin: driver earnings + payouts ────────────────────────────────────────

router.get(
  '/drivers/:driver_id/earnings',
  requireAuthV2, requireRole('admin'),
  async (req: Request, res: Response) => {
    const { driver_id } = req.params;

    const { rows } = await db.query(
      `SELECT
         se.session_id,
         se.delivery_fee_cents,
         se.rolling_score_used,
         se.base_pay_cents,
         se.bonus_pay_cents,
         se.driver_pay_cents,
         se.platform_cut_cents,
         se.status,
         se.payout_id,
         se.calculated_at,
         ds.completed_at AS session_completed_at
       FROM session_earnings se
       JOIN delivery_sessions ds ON ds.id = se.session_id
       WHERE se.driver_id = $1
       ORDER BY se.calculated_at DESC
       LIMIT 100`,
      [driver_id],
    );

    res.json({ earnings: rows });
  },
);

router.get(
  '/drivers/:driver_id/payouts',
  requireAuthV2, requireRole('admin'),
  async (req: Request, res: Response) => {
    const { driver_id } = req.params;

    const { rows } = await db.query(
      `SELECT id, period_start, period_end, sessions_count, total_cents, status,
              stripe_transfer_id, initiated_at, paid_at
       FROM payouts
       WHERE driver_id = $1
       ORDER BY initiated_at DESC`,
      [driver_id],
    );

    res.json({ payouts: rows });
  },
);

// ─── Admin: trigger payout ────────────────────────────────────────────────────

router.post('/trigger', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { driver_id, period_start, period_end } = req.body;

  if (!driver_id || !period_start || !period_end) {
    return res.status(400).json({ error: 'driver_id, period_start, period_end required' });
  }

  // Validate date format (YYYY-MM-DD)
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(period_start) || !dateRe.test(period_end)) {
    return res.status(400).json({ error: 'period_start and period_end must be YYYY-MM-DD' });
  }

  if (period_end < period_start) {
    return res.status(400).json({ error: 'period_end must not be before period_start' });
  }

  const payoutId = await triggerPayoutForDriver(driver_id, period_start, period_end);

  if (!payoutId) {
    return res.status(200).json({ message: 'No pending earnings found for period', payout: null });
  }

  const { rows: [payout] } = await db.query(
    `SELECT * FROM payouts WHERE id = $1`,
    [payoutId],
  );

  res.status(201).json({ payout });
});

// ─── Admin: mark payout paid ──────────────────────────────────────────────────

router.post(
  '/:payout_id/mark-paid',
  requireAuthV2, requireRole('admin'),
  async (req: Request, res: Response) => {
    const { payout_id } = req.params;
    const { stripe_transfer_id } = req.body;

    const { rows } = await db.query(
      `SELECT id, status FROM payouts WHERE id = $1`,
      [payout_id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Payout not found' });
    if (rows[0].status === 'paid') {
      return res.status(409).json({ error: 'Payout already marked paid' });
    }

    await markPayoutPaid(payout_id, stripe_transfer_id);

    const { rows: [payout] } = await db.query(
      `SELECT * FROM payouts WHERE id = $1`,
      [payout_id],
    );

    res.json({ payout });
  },
);

export default router;

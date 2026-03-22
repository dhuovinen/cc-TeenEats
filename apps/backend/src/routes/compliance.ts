/**
 * Compliance routes — MVP Module 4
 *
 * Driver:
 *   GET  /compliance/status        — current compliance status for authenticated driver
 *
 * Admin:
 *   GET  /compliance/rules         — list all state compliance rules
 *   GET  /compliance/rules/:state  — single state rule
 *   GET  /compliance/violations    — recent violations (admin view)
 *
 * Internal (admin only for now, will be called by cron in production):
 *   POST /compliance/record        — record work minutes for a driver
 */
import { Router, Request, Response } from 'express';
import { requireAuthV2, requireRole } from '../middleware/authV2';
import {
  canStartSession,
  recordWorkTime,
  getComplianceRule,
} from '../services/compliance';
import { db } from '../db';

const router = Router();

// ─── Driver: compliance status ────────────────────────────────────────────────

router.get('/status', requireAuthV2, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    const result = await canStartSession(req.userId!);
    res.json({ compliance: result });
  } catch (err) {
    console.error('[compliance] status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: list all rules ────────────────────────────────────────────────────

router.get('/rules', requireAuthV2, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query('SELECT * FROM compliance_rules ORDER BY state');
    res.json({ rules: rows });
  } catch (err) {
    console.error('[compliance] rules error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: single state rule ─────────────────────────────────────────────────

router.get('/rules/:state', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const rule = await getComplianceRule(req.params.state.toUpperCase());
    if (!rule) { res.status(404).json({ error: 'No rule for this state' }); return; }
    res.json({ rule });
  } catch (err) {
    console.error('[compliance] rule error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: record work minutes ───────────────────────────────────────────────

router.post('/record', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { driver_id, minutes, date } = req.body;
  if (!driver_id || !Number.isInteger(minutes) || minutes <= 0) {
    res.status(400).json({ error: 'driver_id and positive integer minutes are required' });
    return;
  }
  try {
    const workDate = date ? new Date(date) : new Date();
    await recordWorkTime(driver_id, minutes, workDate);
    res.json({ ok: true });
  } catch (err) {
    console.error('[compliance] record error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: recent violations ─────────────────────────────────────────────────

router.get('/violations', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { driver_id, limit = '50' } = req.query;
  try {
    const params: any[] = [parseInt(limit as string, 10)];
    let whereClause = '';
    if (driver_id) {
      whereClause = 'WHERE driver_id = $2';
      params.push(driver_id);
    }
    const { rows } = await db.query(
      `SELECT cv.*, u.full_name AS driver_name
       FROM compliance_violations cv
       JOIN users u ON u.id = cv.driver_id
       ${whereClause}
       ORDER BY occurred_at DESC
       LIMIT $1`,
      params
    );
    res.json({ violations: rows });
  } catch (err) {
    console.error('[compliance] violations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

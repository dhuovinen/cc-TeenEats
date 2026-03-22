/**
 * Safety Scoring v1 routes — MVP Module 5
 *
 * Driver:
 *   POST /scoring/events                  — batch-submit driving events during session
 *   GET  /scoring/sessions/:session_id    — get session score breakdown
 *   GET  /scoring/me                      — driver's rolling score + recent sessions
 *
 * Admin:
 *   GET  /scoring/drivers/:driver_id      — any driver's rolling score + sessions
 *   POST /scoring/sessions/:session_id/calculate  — manually trigger score calc
 */
import { Router, Request, Response } from 'express';
import { requireAuthV2, requireRole } from '../middleware/authV2';
import {
  recordDrivingEvents,
  finalizeSessionScore,
  getDriverRollingScore,
} from '../services/scoringV1';
import { db } from '../db';

const router = Router();

// ─── Driver: submit driving events ───────────────────────────────────────────

router.post('/events', requireAuthV2, requireRole('driver'), async (req: Request, res: Response) => {
  const { session_id, events } = req.body;
  const driverId = req.userId!;

  if (!session_id || !Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: 'session_id and non-empty events[] are required' });
    return;
  }

  // Verify the session belongs to this driver
  const { rows: [session] } = await db.query(
    `SELECT id, driver_id FROM delivery_sessions WHERE id = $1`,
    [session_id]
  );
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  if (session.driver_id !== driverId) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const penaltyCount = await recordDrivingEvents(session_id, driverId, events);
    res.status(201).json({ ok: true, events_recorded: events.length, penalties_triggered: penaltyCount });
  } catch (err) {
    console.error('[scoring] events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Driver/Admin: get session score breakdown ────────────────────────────────

router.get('/sessions/:session_id', requireAuthV2, async (req: Request, res: Response) => {
  const { session_id } = req.params;
  try {
    const { rows: [score] } = await db.query(
      `SELECT ss.*, ds.order_id FROM session_scores ss
       JOIN delivery_sessions ds ON ds.id = ss.session_id
       WHERE ss.session_id = $1`,
      [session_id]
    );
    if (!score) { res.status(404).json({ error: 'Score not found' }); return; }

    // Access control: driver can only see own sessions
    if (req.userRole === 'driver' && score.driver_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }

    res.json({ score });
  } catch (err) {
    console.error('[scoring] session score error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: manually calculate score for a session ───────────────────────────

router.post('/sessions/:session_id/calculate', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await finalizeSessionScore(req.params.session_id);
    res.json({ ok: true, score: result });
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      res.status(404).json({ error: err.message }); return;
    }
    console.error('[scoring] calculate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Driver: own rolling score ────────────────────────────────────────────────

router.get('/me', requireAuthV2, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    const rolling = await getDriverRollingScore(req.userId!);

    // Recent sessions
    const { rows: sessions } = await db.query(
      `SELECT ss.session_id, ss.final_score, ss.speed_violations, ss.braking_violations,
              ss.event_count, ss.calculated_at
       FROM session_scores ss
       WHERE ss.driver_id = $1
       ORDER BY ss.calculated_at DESC LIMIT 10`,
      [req.userId]
    );

    res.json({ ...rolling, recent_sessions: sessions });
  } catch (err) {
    console.error('[scoring] me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: any driver's rolling score ───────────────────────────────────────

router.get('/drivers/:driver_id', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const rolling = await getDriverRollingScore(req.params.driver_id);

    const { rows: sessions } = await db.query(
      `SELECT ss.session_id, ss.final_score, ss.speed_violations, ss.braking_violations,
              ss.event_count, ss.calculated_at
       FROM session_scores ss
       WHERE ss.driver_id = $1
       ORDER BY ss.calculated_at DESC LIMIT 20`,
      [req.params.driver_id]
    );

    res.json({ ...rolling, recent_sessions: sessions });
  } catch (err) {
    console.error('[scoring] drivers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

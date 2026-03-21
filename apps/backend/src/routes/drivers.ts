import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireDriverAuth, requireDispatcherKey } from '../middleware/auth';
import { getIO } from '../socket';
import { getDriverScoreBreakdown } from '../services/scoring';

const router = Router();

// GET /drivers — dispatcher: list all drivers with status + score
router.get('/', requireDispatcherKey, async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, status, safety_score, created_at
       FROM drivers ORDER BY name ASC`
    );
    res.json({ drivers: result.rows });
  } catch (err) {
    console.error('[drivers] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /drivers/:id/status — driver: toggle online/offline
router.patch('/:id/status', requireDriverAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };

  if (req.driverId !== id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (status !== 'online' && status !== 'offline') {
    res.status(400).json({ error: 'status must be "online" or "offline"' });
    return;
  }

  try {
    // Cannot go offline while busy (active delivery in progress)
    const current = await db.query(
      `SELECT status FROM drivers WHERE id = $1`,
      [id]
    );
    if (current.rows[0]?.status === 'busy') {
      res.status(409).json({ error: 'Cannot change status while on an active delivery' });
      return;
    }

    const result = await db.query(
      `UPDATE drivers SET status = $1 WHERE id = $2
       RETURNING id, name, status, safety_score`,
      [status, id]
    );
    const driver = result.rows[0];

    // Notify dispatcher of status change
    getIO().to('dispatcher').emit('driver_status_change', {
      driverId: driver.id,
      name: driver.name,
      status: driver.status,
    });

    res.json({ driver });
  } catch (err) {
    console.error('[drivers] status update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /drivers/:id/score — driver: get own score breakdown
router.get('/:id/score', requireDriverAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  if (req.driverId !== id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const breakdown = await getDriverScoreBreakdown(db, id);
    res.json({ score: breakdown });
  } catch (err) {
    console.error('[drivers] score error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

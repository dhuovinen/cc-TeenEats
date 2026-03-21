import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireDispatcherKey } from '../middleware/auth';

const router = Router();

// GET /settings — dispatcher: get all settings as key-value map
router.get('/', requireDispatcherKey, async (_req: Request, res: Response) => {
  try {
    const result = await db.query(`SELECT key, value FROM settings ORDER BY key`);
    const settings: Record<string, string> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    res.json({ settings });
  } catch (err) {
    console.error('[settings] get error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /settings — dispatcher: update a setting
router.put('/', requireDispatcherKey, async (req: Request, res: Response) => {
  const { key, value } = req.body as { key?: string; value?: string };
  if (!key || value === undefined) {
    res.status(400).json({ error: 'key and value required' });
    return;
  }

  // Validate known keys
  if (key === 'request_timeout_seconds') {
    const seconds = parseInt(value, 10);
    if (isNaN(seconds) || seconds < 5 || seconds > 3600) {
      res.status(400).json({ error: 'request_timeout_seconds must be 5–3600' });
      return;
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING key, value`,
      [key, value]
    );
    res.json({ setting: result.rows[0] });
  } catch (err) {
    console.error('[settings] update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

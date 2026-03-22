/**
 * Restaurant & Menu routes — MVP Module 2
 *
 * Public (no auth):
 *   GET  /restaurants              — list active restaurants
 *   GET  /restaurants/:id          — restaurant detail + full menu
 *
 * Admin only:
 *   POST   /restaurants                        — create restaurant
 *   PUT    /restaurants/:id                    — update restaurant
 *   DELETE /restaurants/:id                    — deactivate restaurant
 *   POST   /restaurants/:id/hours              — set/replace hours
 *   POST   /restaurants/:id/categories         — add menu category
 *   PUT    /restaurants/:id/categories/:cid    — update category
 *   DELETE /restaurants/:id/categories/:cid    — delete category
 *   POST   /restaurants/:id/items              — add menu item
 *   PUT    /menu-items/:id                     — update menu item
 *   DELETE /menu-items/:id                     — delete menu item
 *   PATCH  /menu-items/:id/availability        — toggle available flag
 */
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuthV2, requireRole } from '../middleware/authV2';

const router = Router();

// ─── Public: list active restaurants ─────────────────────────────────────────

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, description, address, lat, lng, phone, cuisine_type, image_url, created_at
      FROM restaurants
      WHERE active = TRUE
      ORDER BY name ASC
    `);
    res.json({ restaurants: rows });
  } catch (err) {
    console.error('[restaurants] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Public: restaurant detail + full menu ────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const restResult = await db.query(`
      SELECT id, name, description, address, lat, lng, phone, cuisine_type, image_url, created_at
      FROM restaurants
      WHERE id = $1 AND active = TRUE
    `, [id]);

    if (!restResult.rows[0]) {
      res.status(404).json({ error: 'Restaurant not found' });
      return;
    }

    const hoursResult = await db.query(`
      SELECT day_of_week, open_time, close_time
      FROM restaurant_hours
      WHERE restaurant_id = $1
      ORDER BY day_of_week ASC
    `, [id]);

    const categoriesResult = await db.query(`
      SELECT
        mc.id, mc.name, mc.display_order,
        COALESCE(
          json_agg(
            json_build_object(
              'id',          mi.id,
              'name',        mi.name,
              'description', mi.description,
              'price_cents', mi.price_cents,
              'available',   mi.available,
              'image_url',   mi.image_url
            ) ORDER BY mi.name
          ) FILTER (WHERE mi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM menu_categories mc
      LEFT JOIN menu_items mi
        ON mi.category_id = mc.id AND mi.available = TRUE
      WHERE mc.restaurant_id = $1
      GROUP BY mc.id, mc.name, mc.display_order
      ORDER BY mc.display_order ASC, mc.name ASC
    `, [id]);

    res.json({
      restaurant: {
        ...restResult.rows[0],
        hours:      hoursResult.rows,
        categories: categoriesResult.rows,
      },
    });
  } catch (err) {
    console.error('[restaurants] detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: create restaurant ─────────────────────────────────────────────────

router.post('/', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { name, description, address, lat, lng, phone, cuisine_type, image_url } =
    req.body as Record<string, string | number | undefined>;

  const missing = ['name', 'address', 'lat', 'lng', 'cuisine_type']
    .filter(k => req.body[k] === undefined || req.body[k] === '');
  if (missing.length) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    return;
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (isNaN(latNum) || latNum < -90  || latNum > 90) {
    res.status(400).json({ error: 'lat must be a number between -90 and 90' });
    return;
  }
  if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
    res.status(400).json({ error: 'lng must be a number between -180 and 180' });
    return;
  }

  try {
    const { rows } = await db.query(`
      INSERT INTO restaurants (name, description, address, lat, lng, phone, cuisine_type, image_url, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, description, address, lat, lng, phone, cuisine_type, image_url, active, created_at
    `, [name, description ?? null, address, latNum, lngNum, phone ?? null, cuisine_type, image_url ?? null, req.userId]);

    res.status(201).json({ restaurant: rows[0] });
  } catch (err) {
    console.error('[restaurants] create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: update restaurant ─────────────────────────────────────────────────

router.put('/:id', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, address, lat, lng, phone, cuisine_type, image_url } =
    req.body as Record<string, string | number | undefined>;

  if (lat !== undefined) {
    const latNum = Number(lat);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      res.status(400).json({ error: 'lat must be a number between -90 and 90' });
      return;
    }
  }
  if (lng !== undefined) {
    const lngNum = Number(lng);
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      res.status(400).json({ error: 'lng must be a number between -180 and 180' });
      return;
    }
  }

  try {
    const existing = await db.query('SELECT id FROM restaurants WHERE id = $1', [id]);
    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Restaurant not found' });
      return;
    }

    const { rows } = await db.query(`
      UPDATE restaurants SET
        name         = COALESCE($1, name),
        description  = COALESCE($2, description),
        address      = COALESCE($3, address),
        lat          = COALESCE($4, lat),
        lng          = COALESCE($5, lng),
        phone        = COALESCE($6, phone),
        cuisine_type = COALESCE($7, cuisine_type),
        image_url    = COALESCE($8, image_url),
        updated_at   = NOW()
      WHERE id = $9
      RETURNING id, name, description, address, lat, lng, phone, cuisine_type, image_url, active, updated_at
    `, [name ?? null, description ?? null, address ?? null,
        lat !== undefined ? Number(lat) : null,
        lng !== undefined ? Number(lng) : null,
        phone ?? null, cuisine_type ?? null, image_url ?? null, id]);

    res.json({ restaurant: rows[0] });
  } catch (err) {
    console.error('[restaurants] update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: deactivate restaurant ────────────────────────────────────────────

router.delete('/:id', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(`
      UPDATE restaurants SET active = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, active
    `, [id]);

    if (!rows[0]) {
      res.status(404).json({ error: 'Restaurant not found' });
      return;
    }
    res.json({ restaurant: rows[0] });
  } catch (err) {
    console.error('[restaurants] deactivate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: set hours (full replace) ─────────────────────────────────────────

router.post('/:id/hours', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { hours } = req.body as {
    hours?: Array<{ day_of_week: number; open_time: string; close_time: string }>;
  };

  if (!Array.isArray(hours)) {
    res.status(400).json({ error: 'hours must be an array' });
    return;
  }

  for (const h of hours) {
    if (h.day_of_week < 0 || h.day_of_week > 6) {
      res.status(400).json({ error: 'day_of_week must be 0 (Sun) through 6 (Sat)' });
      return;
    }
    if (!h.open_time || !h.close_time) {
      res.status(400).json({ error: 'each hour entry requires open_time and close_time' });
      return;
    }
    if (h.open_time >= h.close_time) {
      res.status(400).json({ error: `open_time must be before close_time (day ${h.day_of_week})` });
      return;
    }
  }

  try {
    const existing = await db.query('SELECT id FROM restaurants WHERE id = $1', [id]);
    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Restaurant not found' });
      return;
    }

    const client = await (db as any).connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM restaurant_hours WHERE restaurant_id = $1', [id]);

      for (const h of hours) {
        await client.query(
          `INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_time, close_time)
           VALUES ($1, $2, $3, $4)`,
          [id, h.day_of_week, h.open_time, h.close_time]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      'SELECT day_of_week, open_time, close_time FROM restaurant_hours WHERE restaurant_id = $1 ORDER BY day_of_week',
      [id]
    );
    res.json({ hours: rows });
  } catch (err) {
    console.error('[restaurants] set-hours error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: add menu category ─────────────────────────────────────────────────

router.post('/:id/categories', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, display_order } = req.body as { name?: string; display_order?: number };

  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  try {
    const existing = await db.query('SELECT id FROM restaurants WHERE id = $1', [id]);
    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Restaurant not found' });
      return;
    }

    const { rows } = await db.query(`
      INSERT INTO menu_categories (restaurant_id, name, display_order)
      VALUES ($1, $2, $3)
      RETURNING id, name, display_order
    `, [id, name.trim(), display_order ?? 0]);

    res.status(201).json({ category: rows[0] });
  } catch (err) {
    console.error('[restaurants] add-category error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: update category ───────────────────────────────────────────────────

router.put('/:id/categories/:cid', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id, cid } = req.params;
  const { name, display_order } = req.body as { name?: string; display_order?: number };

  try {
    const { rows } = await db.query(`
      UPDATE menu_categories SET
        name          = COALESCE($1, name),
        display_order = COALESCE($2, display_order)
      WHERE id = $3 AND restaurant_id = $4
      RETURNING id, name, display_order
    `, [name ?? null, display_order ?? null, cid, id]);

    if (!rows[0]) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json({ category: rows[0] });
  } catch (err) {
    console.error('[restaurants] update-category error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: delete category ───────────────────────────────────────────────────

router.delete('/:id/categories/:cid', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id, cid } = req.params;
  try {
    const { rows } = await db.query(
      'DELETE FROM menu_categories WHERE id = $1 AND restaurant_id = $2 RETURNING id',
      [cid, id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[restaurants] delete-category error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: add menu item ─────────────────────────────────────────────────────

router.post('/:id/items', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { category_id, name, description, price_cents, image_url } =
    req.body as Record<string, string | number | undefined>;

  const missing = ['category_id', 'name', 'price_cents']
    .filter(k => req.body[k] === undefined || req.body[k] === '');
  if (missing.length) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    return;
  }

  const price = Number(price_cents);
  if (!Number.isInteger(price) || price < 0) {
    res.status(400).json({ error: 'price_cents must be a non-negative integer' });
    return;
  }

  try {
    // Verify category belongs to this restaurant
    const catCheck = await db.query(
      'SELECT id FROM menu_categories WHERE id = $1 AND restaurant_id = $2',
      [category_id, id]
    );
    if (!catCheck.rows[0]) {
      res.status(404).json({ error: 'Category not found for this restaurant' });
      return;
    }

    const { rows } = await db.query(`
      INSERT INTO menu_items (category_id, restaurant_id, name, description, price_cents, image_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, description, price_cents, available, image_url, created_at
    `, [category_id, id, (name as string).trim(), description ?? null, price, image_url ?? null]);

    res.status(201).json({ item: rows[0] });
  } catch (err) {
    console.error('[restaurants] add-item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: update menu item ──────────────────────────────────────────────────

router.put('/menu-items/:id', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, price_cents, image_url } =
    req.body as Record<string, string | number | undefined>;

  if (price_cents !== undefined) {
    const price = Number(price_cents);
    if (!Number.isInteger(price) || price < 0) {
      res.status(400).json({ error: 'price_cents must be a non-negative integer' });
      return;
    }
  }

  try {
    const { rows } = await db.query(`
      UPDATE menu_items SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        price_cents = COALESCE($3, price_cents),
        image_url   = COALESCE($4, image_url),
        updated_at  = NOW()
      WHERE id = $5
      RETURNING id, name, description, price_cents, available, image_url, updated_at
    `, [name ?? null, description ?? null,
        price_cents !== undefined ? Number(price_cents) : null,
        image_url ?? null, id]);

    if (!rows[0]) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }
    res.json({ item: rows[0] });
  } catch (err) {
    console.error('[restaurants] update-item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: delete menu item ──────────────────────────────────────────────────

router.delete('/menu-items/:id', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      'DELETE FROM menu_items WHERE id = $1 RETURNING id',
      [id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[restaurants] delete-item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: toggle item availability ─────────────────────────────────────────

router.patch('/menu-items/:id/availability', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { available } = req.body as { available?: boolean };

  if (typeof available !== 'boolean') {
    res.status(400).json({ error: 'available must be a boolean' });
    return;
  }

  try {
    const { rows } = await db.query(`
      UPDATE menu_items SET available = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, name, available
    `, [available, id]);

    if (!rows[0]) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }
    res.json({ item: rows[0] });
  } catch (err) {
    console.error('[restaurants] toggle-availability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

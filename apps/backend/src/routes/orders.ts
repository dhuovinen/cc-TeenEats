/**
 * Order Lifecycle routes — MVP Module 3
 *
 * Status machine:
 *   placed → confirmed → ready_for_pickup → assigned → picked_up → delivered
 *                                                             ↘ cancelled (any non-terminal state)
 *
 * Customer routes (role: customer):
 *   POST   /orders                  — place order
 *   GET    /orders/:id              — get order status
 *   GET    /orders/mine             — list my orders
 *   POST   /orders/:id/cancel       — cancel order (placed only)
 *
 * Restaurant/Admin routes (role: admin for MVP):
 *   GET    /orders/restaurant/:rid  — pending orders for a restaurant
 *   POST   /orders/:id/confirm      — restaurant confirms order
 *   POST   /orders/:id/ready        — order ready for pickup
 *
 * Driver routes (role: driver):
 *   GET    /orders/available        — orders in ready_for_pickup state
 *   POST   /orders/:id/accept       — driver accepts (→ assigned)
 *   POST   /orders/:id/pickup       — driver picked up (→ picked_up)
 *   POST   /orders/:id/deliver      — delivery complete (→ delivered)
 */
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuthV2, requireRole } from '../middleware/authV2';
import { canStartSession, recordWorkTime, logViolation } from '../services/compliance';
import { finalizeSessionScore } from '../services/scoringV1';
import { computeAndSaveSessionEarnings } from '../services/payoutsV1';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getOrder(id: string) {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] || null;
}

// ─── Customer: place order ────────────────────────────────────────────────────

router.post('/', requireAuthV2, requireRole('customer'), async (req: Request, res: Response) => {
  const { restaurant_id, items, delivery_address, delivery_lat, delivery_lng, notes } = req.body;
  const customer_id = req.userId!;

  if (!restaurant_id || !Array.isArray(items) || items.length === 0 || !delivery_address) {
    res.status(400).json({ error: 'restaurant_id, items[], and delivery_address are required' });
    return;
  }

  // Validate restaurant exists and is active
  const { rows: [restaurant] } = await db.query(
    'SELECT id FROM restaurants WHERE id = $1 AND active = TRUE',
    [restaurant_id]
  );
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found or inactive' });
    return;
  }

  // Validate and fetch menu items (only available items)
  const menuItemIds = items.map((i: any) => i.menu_item_id);
  const { rows: menuItems } = await db.query(
    `SELECT id, name, price_cents FROM menu_items
     WHERE id = ANY($1::uuid[]) AND available = TRUE AND restaurant_id = $2`,
    [menuItemIds, restaurant_id]
  );

  if (menuItems.length !== menuItemIds.length) {
    res.status(400).json({ error: 'One or more menu items are invalid, unavailable, or from the wrong restaurant' });
    return;
  }

  // Validate quantities
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      res.status(400).json({ error: 'Each item must have a positive integer quantity' });
      return;
    }
  }

  // Build item map for price lookup
  const itemMap = new Map(menuItems.map((m: any) => [m.id, m]));

  // Calculate total
  let total_cents = 0;
  const orderItems = items.map((i: any) => {
    const mi = itemMap.get(i.menu_item_id) as any;
    const line_total = mi.price_cents * i.quantity;
    total_cents += line_total;
    return { menu_item_id: i.menu_item_id, quantity: i.quantity, price_cents: mi.price_cents, item_name: mi.name };
  });

  try {
    await db.query('BEGIN');

    const { rows: [order] } = await db.query(
      `INSERT INTO orders
         (customer_id, restaurant_id, total_cents, delivery_address, delivery_lat, delivery_lng, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [customer_id, restaurant_id, total_cents, delivery_address, delivery_lat || null, delivery_lng || null, notes || null]
    );

    for (const item of orderItems) {
      await db.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, price_cents, item_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.menu_item_id, item.quantity, item.price_cents, item.item_name]
      );
    }

    await db.query('COMMIT');
    res.status(201).json({ order: { ...order, items: orderItems } });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[orders] place error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Customer: my orders ──────────────────────────────────────────────────────

router.get('/mine', requireAuthV2, requireRole('customer'), async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      `SELECT o.*, r.name AS restaurant_name
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.customer_id = $1
       ORDER BY o.placed_at DESC`,
      [req.userId]
    );
    res.json({ orders: rows });
  } catch (err) {
    console.error('[orders] mine error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Driver: available orders ─────────────────────────────────────────────────

router.get('/available', requireAuthV2, requireRole('driver'), async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      `SELECT o.*, r.name AS restaurant_name, r.address AS restaurant_address,
              r.lat AS restaurant_lat, r.lng AS restaurant_lng
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.status = 'ready_for_pickup'
       ORDER BY o.ready_at ASC`
    );
    res.json({ orders: rows });
  } catch (err) {
    console.error('[orders] available error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Restaurant/Admin: orders for a restaurant ────────────────────────────────

router.get('/restaurant/:rid', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  const { status } = req.query;
  try {
    const params: any[] = [req.params.rid];
    let statusClause = '';
    if (status) {
      statusClause = 'AND o.status = $2';
      params.push(status);
    }
    const { rows } = await db.query(
      `SELECT o.* FROM orders o
       WHERE o.restaurant_id = $1 ${statusClause}
       ORDER BY o.placed_at DESC`,
      params
    );
    res.json({ orders: rows });
  } catch (err) {
    console.error('[orders] restaurant orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id — order detail (customer sees own, driver sees assigned, admin sees all) ────

router.get('/:id', requireAuthV2, async (req: Request, res: Response) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Access control
    const role = req.userRole!;
    const userId = req.userId!;
    if (role === 'customer' && order.customer_id !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (role === 'driver' && order.driver_id !== userId && order.status !== 'ready_for_pickup') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Fetch items
    const { rows: items } = await db.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [order.id]
    );
    res.json({ order: { ...order, items } });
  } catch (err) {
    console.error('[orders] get error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Customer: cancel order ────────────────────────────────────────────────────

router.post('/:id/cancel', requireAuthV2, requireRole('customer'), async (req: Request, res: Response) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.customer_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (order.status !== 'placed') {
      res.status(409).json({ error: `Cannot cancel order in status '${order.status}'` });
      return;
    }

    const { rows: [updated] } = await db.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [order.id, req.body.reason || 'Customer cancelled']
    );
    res.json({ order: updated });
  } catch (err) {
    console.error('[orders] cancel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Restaurant/Admin: confirm order ─────────────────────────────────────────

router.post('/:id/confirm', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.status !== 'placed') {
      res.status(409).json({ error: `Cannot confirm order in status '${order.status}'` });
      return;
    }

    const { rows: [updated] } = await db.query(
      `UPDATE orders SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [order.id]
    );
    res.json({ order: updated });
  } catch (err) {
    console.error('[orders] confirm error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Restaurant/Admin: mark ready for pickup ──────────────────────────────────

router.post('/:id/ready', requireAuthV2, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.status !== 'confirmed') {
      res.status(409).json({ error: `Cannot mark ready in status '${order.status}'` });
      return;
    }

    const { rows: [updated] } = await db.query(
      `UPDATE orders SET status = 'ready_for_pickup', ready_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [order.id]
    );
    res.json({ order: updated });
  } catch (err) {
    console.error('[orders] ready error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Driver: accept order ─────────────────────────────────────────────────────

router.post('/:id/accept', requireAuthV2, requireRole('driver'), async (req: Request, res: Response) => {
  const driver_id = req.userId!;
  try {
    // Compliance check: enforce minor labor law hour caps and curfews
    const compliance = await canStartSession(driver_id);
    if (!compliance.allowed) {
      // Log the blocked attempt
      const { rows: [profile] } = await db.query(
        'SELECT state FROM driver_profiles WHERE user_id = $1',
        [driver_id]
      );
      await logViolation(driver_id, compliance, profile?.state ?? '??');
      res.status(403).json({
        error: 'Compliance block: cannot accept orders at this time',
        compliance,
      });
      return;
    }

    // Race-condition safe: use UPDATE with WHERE clause, check rows updated
    const { rows, rowCount } = await db.query(
      `UPDATE orders
       SET status = 'assigned', driver_id = $2, assigned_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'ready_for_pickup'
       RETURNING *`,
      [req.params.id, driver_id]
    );

    if (rowCount === 0) {
      // Either not found or already assigned
      const order = await getOrder(req.params.id);
      if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
      res.status(409).json({ error: `Order is no longer available (status: ${order.status})` });
      return;
    }

    // Create delivery session; return its id so driver app can submit scoring events
    const { rows: [deliverySession] } = await db.query(
      `INSERT INTO delivery_sessions (order_id, driver_id) VALUES ($1, $2) RETURNING id`,
      [req.params.id, driver_id]
    );

    res.json({ order: rows[0], delivery_session_id: deliverySession.id });
  } catch (err) {
    console.error('[orders] accept error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Driver: mark picked up ───────────────────────────────────────────────────

router.post('/:id/pickup', requireAuthV2, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.driver_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (order.status !== 'assigned') {
      res.status(409).json({ error: `Cannot pick up order in status '${order.status}'` });
      return;
    }

    await db.query('BEGIN');

    const { rows: [updated] } = await db.query(
      `UPDATE orders SET status = 'picked_up', picked_up_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [order.id]
    );

    await db.query(
      `UPDATE delivery_sessions SET picked_up_at = NOW() WHERE order_id = $1`,
      [order.id]
    );

    await db.query('COMMIT');
    res.json({ order: updated });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[orders] pickup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Driver: mark delivered ───────────────────────────────────────────────────

router.post('/:id/deliver', requireAuthV2, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.driver_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (order.status !== 'picked_up') {
      res.status(409).json({ error: `Cannot deliver order in status '${order.status}'` });
      return;
    }

    await db.query('BEGIN');

    const { rows: [updated] } = await db.query(
      `UPDATE orders SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [order.id]
    );

    const { distance_km, duration_minutes } = req.body;
    await db.query(
      `UPDATE delivery_sessions
       SET completed_at = NOW(), distance_km = $2, duration_minutes = $3
       WHERE order_id = $1`,
      [order.id, distance_km || null, duration_minutes || null]
    );

    await db.query('COMMIT');

    // Record work time for compliance tracking (outside transaction)
    if (duration_minutes && Number.isFinite(duration_minutes)) {
      recordWorkTime(order.driver_id, duration_minutes).catch(err =>
        console.error('[orders] recordWorkTime error:', err)
      );
    }

    // Finalize session safety score (outside transaction — best effort)
    const { rows: [ds] } = await db.query(
      'SELECT id FROM delivery_sessions WHERE order_id = $1',
      [order.id]
    );
    if (ds) {
      finalizeSessionScore(ds.id).catch(err =>
        console.error('[orders] finalizeSessionScore error:', err)
      );
      computeAndSaveSessionEarnings(ds.id).catch(err =>
        console.error('[orders] computeAndSaveSessionEarnings error:', err)
      );
    }
    res.json({ order: updated });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[orders] deliver error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

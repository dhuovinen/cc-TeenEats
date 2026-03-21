import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireDriverAuth, requireDispatcherKey } from '../middleware/auth';
import { getIO, broadcastDeliveryRequest, broadcastRequestExpired } from '../socket';
import { estimateMinutes } from '../services/eta';
import { startDeliveryTimeout, clearDeliveryTimeout } from '../services/timeout';
import { recordDeliveryCompletion } from '../services/scoring';

const router = Router();

// GET /deliveries — dispatcher: list all deliveries (newest first)
router.get('/', requireDispatcherKey, async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT d.*, dr.name AS driver_name
       FROM deliveries d
       LEFT JOIN drivers dr ON d.driver_id = dr.id
       ORDER BY d.created_at DESC
       LIMIT 100`
    );
    res.json({ deliveries: result.rows });
  } catch (err) {
    console.error('[deliveries] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /deliveries — dispatcher: create new delivery request
router.post('/', requireDispatcherKey, async (req: Request, res: Response) => {
  const {
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    item_description,
  } = req.body as {
    pickup_address?: string;
    pickup_lat?: number;
    pickup_lng?: number;
    dropoff_address?: string;
    dropoff_lat?: number;
    dropoff_lng?: number;
    item_description?: string;
  };

  if (
    !pickup_address || pickup_lat == null || pickup_lng == null ||
    !dropoff_address || dropoff_lat == null || dropoff_lng == null ||
    !item_description
  ) {
    res.status(400).json({ error: 'All fields required: pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, item_description' });
    return;
  }

  try {
    // Read current timeout setting
    const settingRow = await db.query(
      `SELECT value FROM settings WHERE key = 'request_timeout_seconds'`
    );
    const timeoutSeconds = parseInt(settingRow.rows[0]?.value ?? '60', 10);

    const estimatedMinutes = estimateMinutes(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng);

    const result = await db.query(
      `INSERT INTO deliveries
         (pickup_address, pickup_lat, pickup_lng,
          dropoff_address, dropoff_lat, dropoff_lng,
          item_description, timeout_seconds, estimated_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        pickup_address, pickup_lat, pickup_lng,
        dropoff_address, dropoff_lat, dropoff_lng,
        item_description, timeoutSeconds,
        Math.round(estimatedMinutes * 10) / 10,
      ]
    );
    const delivery = result.rows[0];

    // Find all online (non-busy) drivers
    const onlineDrivers = await db.query<{ id: string }>(
      `SELECT id FROM drivers WHERE status = 'online'`
    );
    const onlineDriverIds = onlineDrivers.rows.map((r) => r.id);

    // Create broadcast records (for acceptance rate tracking)
    for (const driverId of onlineDriverIds) {
      await db.query(
        `INSERT INTO delivery_scores (driver_id, delivery_id, accepted)
         VALUES ($1, $2, false)
         ON CONFLICT (driver_id, delivery_id) DO NOTHING`,
        [driverId, delivery.id]
      );
    }

    // Emit to online drivers + dispatcher
    broadcastDeliveryRequest(onlineDriverIds, { delivery });
    getIO().to('dispatcher').emit('delivery_created', { delivery });

    // Start timeout countdown
    startDeliveryTimeout(db, delivery.id, timeoutSeconds);

    console.log(`[deliveries] created ${delivery.id}, broadcasting to ${onlineDriverIds.length} driver(s), timeout=${timeoutSeconds}s`);
    res.status(201).json({ delivery });
  } catch (err) {
    console.error('[deliveries] create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /deliveries/:id/accept — driver: accept a delivery
router.post('/:id/accept', requireDriverAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const driverId = req.driverId!;

  try {
    // Check driver has no active delivery
    const driverRow = await db.query(
      `SELECT status FROM drivers WHERE id = $1`,
      [driverId]
    );
    if (driverRow.rows[0]?.status === 'busy') {
      res.status(409).json({ error: 'You already have an active delivery' });
      return;
    }

    // Atomically claim the delivery (only if still pending)
    const result = await db.query(
      `UPDATE deliveries
       SET status = 'assigned', driver_id = $1, accepted_at = now()
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [driverId, id]
    );

    if (result.rows.length === 0) {
      res.status(409).json({ error: 'Delivery no longer available' });
      return;
    }
    const delivery = result.rows[0];

    // Clear the timeout
    clearDeliveryTimeout(id);

    // Mark driver as busy
    await db.query(
      `UPDATE drivers SET status = 'busy' WHERE id = $1`,
      [driverId]
    );

    // Record acceptance in delivery_scores
    await db.query(
      `INSERT INTO delivery_scores (driver_id, delivery_id, accepted)
       VALUES ($1, $2, true)
       ON CONFLICT (driver_id, delivery_id) DO UPDATE SET accepted = true`,
      [driverId, id]
    );

    // Notify dispatcher
    const driverInfo = await db.query(
      `SELECT name FROM drivers WHERE id = $1`,
      [driverId]
    );
    getIO().to('dispatcher').emit('delivery_state_change', {
      delivery: { ...delivery, driver_name: driverInfo.rows[0]?.name },
    });
    getIO().to('dispatcher').emit('driver_status_change', {
      driverId,
      name: driverInfo.rows[0]?.name,
      status: 'busy',
    });

    // Expire the request for all other drivers
    broadcastRequestExpired(id);

    console.log(`[deliveries] ${id} accepted by driver ${driverId}`);
    res.json({ delivery });
  } catch (err) {
    console.error('[deliveries] accept error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /deliveries/:id/complete — driver: mark delivery as completed
router.post('/:id/complete', requireDriverAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const driverId = req.driverId!;

  try {
    const result = await db.query(
      `UPDATE deliveries
       SET status = 'completed', completed_at = now()
       WHERE id = $1 AND driver_id = $2 AND status IN ('assigned', 'active')
       RETURNING *`,
      [id, driverId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Delivery not found or not yours to complete' });
      return;
    }
    const delivery = result.rows[0];

    // Free up the driver
    await db.query(
      `UPDATE drivers SET status = 'online' WHERE id = $1`,
      [driverId]
    );

    // Record score + recalculate rolling score
    await recordDeliveryCompletion(db, id, driverId);

    // Fetch updated driver for broadcast
    const driverRow = await db.query(
      `SELECT id, name, status, safety_score FROM drivers WHERE id = $1`,
      [driverId]
    );
    const driver = driverRow.rows[0];

    getIO().to('dispatcher').emit('delivery_state_change', { delivery });
    getIO().to('dispatcher').emit('driver_status_change', {
      driverId,
      name: driver.name,
      status: 'online',
      safety_score: driver.safety_score,
    });

    console.log(`[deliveries] ${id} completed by driver ${driverId}`);
    res.json({ delivery, driver });
  } catch (err) {
    console.error('[deliveries] complete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /deliveries/:id/cancel — dispatcher: cancel a delivery
router.post('/:id/cancel', requireDispatcherKey, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `UPDATE deliveries
       SET status = 'cancelled', cancelled_at = now()
       WHERE id = $1 AND status NOT IN ('completed', 'cancelled')
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Delivery not found or already completed/cancelled' });
      return;
    }
    const delivery = result.rows[0];

    // Clear timeout if it was still pending
    clearDeliveryTimeout(id);

    // If a driver was assigned, free them up
    if (delivery.driver_id) {
      await db.query(
        `UPDATE drivers SET status = 'online' WHERE id = $1`,
        [delivery.driver_id]
      );
      getIO().to(`driver:${delivery.driver_id}`).emit('delivery_cancelled', { deliveryId: id });

      const driverRow = await db.query(
        `SELECT name FROM drivers WHERE id = $1`,
        [delivery.driver_id]
      );
      getIO().to('dispatcher').emit('driver_status_change', {
        driverId: delivery.driver_id,
        name: driverRow.rows[0]?.name,
        status: 'online',
      });
    }

    // Expire for any online drivers still holding the notification
    broadcastRequestExpired(id);

    getIO().to('dispatcher').emit('delivery_state_change', { delivery });
    res.json({ delivery });
  } catch (err) {
    console.error('[deliveries] cancel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /deliveries/:id/location — driver: send GPS update during active delivery
router.post('/:id/location', requireDriverAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const driverId = req.driverId!;
  const { lat, lng } = req.body as { lat?: number; lng?: number };

  if (lat == null || lng == null) {
    res.status(400).json({ error: 'lat and lng required' });
    return;
  }

  try {
    // Verify driver owns this delivery
    const check = await db.query(
      `SELECT id FROM deliveries WHERE id = $1 AND driver_id = $2 AND status IN ('assigned', 'active')`,
      [id, driverId]
    );
    if (check.rows.length === 0) {
      res.status(403).json({ error: 'Not your active delivery' });
      return;
    }

    // Persist location event
    await db.query(
      `INSERT INTO location_events (driver_id, delivery_id, lat, lng)
       VALUES ($1, $2, $3, $4)`,
      [driverId, id, lat, lng]
    );

    // If delivery was 'assigned', transition to 'active' on first location ping
    await db.query(
      `UPDATE deliveries SET status = 'active'
       WHERE id = $1 AND status = 'assigned'`,
      [id]
    );

    // Emit real-time location to dispatcher
    getIO().to('dispatcher').emit('driver_location', {
      driverId,
      deliveryId: id,
      lat,
      lng,
      ts: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[deliveries] location error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

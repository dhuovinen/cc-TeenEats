import { Pool } from 'pg';
import { getIO, broadcastRequestExpired } from '../socket';

// In-memory timeout handles (alpha: single process only)
const deliveryTimeouts = new Map<string, NodeJS.Timeout>();

export function startDeliveryTimeout(
  db: Pool,
  deliveryId: string,
  seconds: number
): void {
  clearDeliveryTimeout(deliveryId); // safety: clear any existing

  const handle = setTimeout(async () => {
    deliveryTimeouts.delete(deliveryId);
    try {
      const result = await db.query(
        `UPDATE deliveries
         SET status = 'timed_out', timed_out_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [deliveryId]
      );
      if (result.rows.length > 0) {
        const delivery = result.rows[0];
        const io = getIO();
        io.to('dispatcher').emit('delivery_state_change', { delivery });
        broadcastRequestExpired(deliveryId);
        console.log(`[timeout] delivery ${deliveryId} timed out`);
      }
    } catch (err) {
      console.error('[timeout] error processing timeout:', err);
    }
  }, seconds * 1000);

  deliveryTimeouts.set(deliveryId, handle);
}

export function clearDeliveryTimeout(deliveryId: string): void {
  const handle = deliveryTimeouts.get(deliveryId);
  if (handle) {
    clearTimeout(handle);
    deliveryTimeouts.delete(deliveryId);
  }
}

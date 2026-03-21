import { Pool } from 'pg';

const ROLLING_WINDOW = 20;
const ON_TIME_BUFFER = 1.25; // 25% grace period

/**
 * Called when a delivery is completed. Records the score and updates the driver's
 * rolling safety_score.
 */
export async function recordDeliveryCompletion(
  db: Pool,
  deliveryId: string,
  driverId: string
): Promise<void> {
  const delivery = await db.query(
    `SELECT accepted_at, completed_at, estimated_minutes FROM deliveries WHERE id = $1`,
    [deliveryId]
  );
  if (!delivery.rows[0]) return;

  const { accepted_at, completed_at, estimated_minutes } = delivery.rows[0];
  const actualMinutes =
    (new Date(completed_at).getTime() - new Date(accepted_at).getTime()) /
    60000;
  const onTime = actualMinutes <= estimated_minutes * ON_TIME_BUFFER;

  await db.query(
    `UPDATE delivery_scores
     SET on_time = $1, completed = true
     WHERE delivery_id = $2 AND driver_id = $3`,
    [onTime, deliveryId, driverId]
  );

  await recalculateDriverScore(db, driverId);
}

/**
 * Recalculates and persists a driver's rolling safety score (0–100).
 * Uses last ROLLING_WINDOW entries for each component.
 */
export async function recalculateDriverScore(
  db: Pool,
  driverId: string
): Promise<number | null> {
  // Acceptance rate: last N broadcasts to this driver
  const broadcastRows = await db.query<{ accepted: boolean }>(
    `SELECT accepted FROM delivery_scores
     WHERE driver_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, ROLLING_WINDOW]
  );

  if (broadcastRows.rows.length === 0) {
    return null; // no data yet
  }

  const totalBroadcasts = broadcastRows.rows.length;
  const acceptedCount = broadcastRows.rows.filter((r) => r.accepted).length;
  const acceptanceScore = (acceptedCount / totalBroadcasts) * 100;

  // On-time rate: last N completed deliveries
  const completedRows = await db.query<{ on_time: boolean }>(
    `SELECT on_time FROM delivery_scores
     WHERE driver_id = $1 AND completed = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, ROLLING_WINDOW]
  );

  const onTimeScore =
    completedRows.rows.length === 0
      ? 100
      : (completedRows.rows.filter((r) => r.on_time).length /
          completedRows.rows.length) *
        100;

  // Completion rate: last N accepted deliveries
  const acceptedRows = await db.query<{ completed: boolean | null }>(
    `SELECT completed FROM delivery_scores
     WHERE driver_id = $1 AND accepted = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, ROLLING_WINDOW]
  );

  const completionScore =
    acceptedRows.rows.length === 0
      ? 100
      : (acceptedRows.rows.filter((r) => r.completed === true).length /
          acceptedRows.rows.length) *
        100;

  const overall = (acceptanceScore + onTimeScore + completionScore) / 3;

  await db.query(`UPDATE drivers SET safety_score = $1 WHERE id = $2`, [
    Math.round(overall * 10) / 10,
    driverId,
  ]);

  return overall;
}

/**
 * Returns a detailed score breakdown for a driver.
 */
export async function getDriverScoreBreakdown(
  db: Pool,
  driverId: string
): Promise<{
  overall: number | null;
  acceptance: number | null;
  onTime: number | null;
  completion: number | null;
  totalDeliveries: number;
}> {
  const broadcastRows = await db.query<{ accepted: boolean }>(
    `SELECT accepted FROM delivery_scores
     WHERE driver_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, ROLLING_WINDOW]
  );

  if (broadcastRows.rows.length === 0) {
    return {
      overall: null,
      acceptance: null,
      onTime: null,
      completion: null,
      totalDeliveries: 0,
    };
  }

  const totalBroadcasts = broadcastRows.rows.length;
  const acceptedCount = broadcastRows.rows.filter((r) => r.accepted).length;
  const acceptance = (acceptedCount / totalBroadcasts) * 100;

  const completedRows = await db.query<{ on_time: boolean }>(
    `SELECT on_time FROM delivery_scores
     WHERE driver_id = $1 AND completed = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, ROLLING_WINDOW]
  );

  const onTime =
    completedRows.rows.length === 0
      ? null
      : (completedRows.rows.filter((r) => r.on_time).length /
          completedRows.rows.length) *
        100;

  const acceptedRows = await db.query<{ completed: boolean | null }>(
    `SELECT completed FROM delivery_scores
     WHERE driver_id = $1 AND accepted = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, ROLLING_WINDOW]
  );

  const completion =
    acceptedRows.rows.length === 0
      ? null
      : (acceptedRows.rows.filter((r) => r.completed === true).length /
          acceptedRows.rows.length) *
        100;

  const overall =
    acceptance != null && onTime != null && completion != null
      ? (acceptance + onTime + completion) / 3
      : acceptance != null
      ? acceptance
      : null;

  const totalDeliveries = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM delivery_scores WHERE driver_id = $1 AND completed = true`,
    [driverId]
  );

  return {
    overall: overall != null ? Math.round(overall * 10) / 10 : null,
    acceptance: acceptance != null ? Math.round(acceptance * 10) / 10 : null,
    onTime: onTime != null ? Math.round(onTime * 10) / 10 : null,
    completion: completion != null ? Math.round(completion * 10) / 10 : null,
    totalDeliveries: parseInt(totalDeliveries.rows[0].count, 10),
  };
}

/**
 * Safety Scoring v1 — MVP Module 5
 *
 * Reference: docs/scoring.md
 *
 * Session score = max(0, 100 - speed_penalty - braking_penalty)
 * Speed caps at -40 pts/session; braking/accel caps at -30 pts/session.
 *
 * Rolling score: last 5 sessions weight 2x, sessions 6–20 weight 1x.
 *
 * Design: pure computation functions + thin DB wrapper.
 */
import { db } from '../db';

// ─── Constants (from scoring.md) ─────────────────────────────────────────────

export const SPEED_PENALTY = {
  LOW: 3,     // 1–10 mph over posted limit
  MEDIUM: 8,  // 11–20 mph over
  HIGH: 20,   // > 20 mph over
} as const;

export const SPEED_PENALTY_CAP = 40;      // max speed deduction per session
export const BRAKING_PENALTY_CAP = 30;   // max braking/accel deduction per session
export const HARSH_G_THRESHOLD = 0.4;    // g-force trigger for harsh event

// ─── Types ────────────────────────────────────────────────────────────────────

export type SpeedSeverity = 'low' | 'medium' | 'high';

export interface SpeedEventInput {
  speed_kph: number;
  speed_limit_kph: number;
  lat?: number;
  lng?: number;
}

export interface BrakingEventInput {
  g_force: number;       // positive magnitude; 0.4+ triggers penalty
  event_type: 'harsh_braking' | 'rapid_acceleration';
  lat?: number;
  lng?: number;
}

export interface SessionScoreResult {
  final_score: number;          // 0–100
  speed_penalty: number;        // capped at SPEED_PENALTY_CAP
  braking_penalty: number;      // capped at BRAKING_PENALTY_CAP
  speed_violations: number;
  braking_violations: number;
  event_count: number;
}

// ─── Pure computation functions ───────────────────────────────────────────────

/**
 * Convert kph difference to mph.
 */
export function kphToMph(kph: number): number {
  return kph * 0.621371;
}

/**
 * Classify speed penalty from mph-over-limit.
 * Returns { penalty, severity } or { penalty: 0, severity: null } if not a violation.
 */
export function classifySpeedViolation(mphOver: number): { penalty: number; severity: SpeedSeverity | null } {
  if (mphOver <= 0) return { penalty: 0, severity: null };
  if (mphOver <= 10) return { penalty: SPEED_PENALTY.LOW, severity: 'low' };
  if (mphOver <= 20) return { penalty: SPEED_PENALTY.MEDIUM, severity: 'medium' };
  return { penalty: SPEED_PENALTY.HIGH, severity: 'high' };
}

/**
 * Classify braking/acceleration penalty from peak g-force.
 * Returns penalty points (0 if below threshold).
 */
export function classifyBrakingPenalty(gForce: number): number {
  return gForce > HARSH_G_THRESHOLD ? 5 : 0;
}

/**
 * Calculate session score from arrays of classified events.
 * Pure — no DB calls.
 */
export function computeSessionScore(
  speedPenalties: number[],   // raw penalty per speed event (pre-cap)
  brakingPenalties: number[], // raw penalty per braking event (pre-cap)
): SessionScoreResult {
  const rawSpeed   = speedPenalties.reduce((s, p) => s + p, 0);
  const rawBraking = brakingPenalties.reduce((s, p) => s + p, 0);

  const speedPenalty   = Math.min(rawSpeed, SPEED_PENALTY_CAP);
  const brakingPenalty = Math.min(rawBraking, BRAKING_PENALTY_CAP);
  const finalScore     = Math.max(0, 100 - speedPenalty - brakingPenalty);

  return {
    final_score: finalScore,
    speed_penalty: speedPenalty,
    braking_penalty: brakingPenalty,
    speed_violations: speedPenalties.filter(p => p > 0).length,
    braking_violations: brakingPenalties.filter(p => p > 0).length,
    event_count: speedPenalties.length + brakingPenalties.length,
  };
}

/**
 * Calculate rolling safety score from array of session scores (chronological order).
 * Last 5 sessions → weight 2; sessions 6–20 → weight 1; beyond 20 → ignored.
 */
export function calculateRollingScore(sessionScores: number[]): number {
  if (sessionScores.length === 0) return 100;

  // Reverse so index 0 = most recent
  const reversed = [...sessionScores].reverse();
  const recent = reversed.slice(0, 5);
  const older  = reversed.slice(5, 20);

  const totalWeight = recent.length * 2 + older.length;
  if (totalWeight === 0) return 100;

  const weightedSum =
    recent.reduce((s, v) => s + v * 2, 0) +
    older.reduce((s, v) => s + v, 0);

  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

/**
 * Score tier label per scoring.md.
 */
export function scoreTier(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Needs Improvement';
  return 'Poor';
}

// ─── DB-backed functions ──────────────────────────────────────────────────────

/**
 * Record a batch of driving events for a session.
 * Returns the count of events that triggered a penalty.
 */
export async function recordDrivingEvents(
  sessionId: string,
  driverId: string,
  events: Array<SpeedEventInput | BrakingEventInput & { event_type: string }>,
): Promise<number> {
  let penaltyCount = 0;

  for (const ev of events) {
    if ('speed_kph' in ev) {
      // Speed event
      const mphOver = kphToMph(ev.speed_kph - ev.speed_limit_kph);
      const { penalty, severity } = classifySpeedViolation(mphOver);
      if (penalty > 0) penaltyCount++;

      await db.query(
        `INSERT INTO driving_events
           (session_id, driver_id, event_type, speed_kph, speed_limit_kph, mph_over,
            speed_severity, lat, lng, penalty_points)
         VALUES ($1,$2,'speed_violation',$3,$4,$5,$6,$7,$8,$9)`,
        [sessionId, driverId, ev.speed_kph, ev.speed_limit_kph,
         Math.max(0, mphOver), severity, ev.lat ?? null, ev.lng ?? null, penalty]
      );
    } else {
      // Braking / acceleration event
      const bEv = ev as BrakingEventInput;
      const penalty = classifyBrakingPenalty(bEv.g_force);
      if (penalty > 0) penaltyCount++;

      await db.query(
        `INSERT INTO driving_events
           (session_id, driver_id, event_type, g_force, lat, lng, penalty_points)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sessionId, driverId, bEv.event_type, bEv.g_force,
         bEv.lat ?? null, bEv.lng ?? null, penalty]
      );
    }
  }

  return penaltyCount;
}

/**
 * Finalize the session score: read all events, compute score, persist to session_scores.
 * Also updates score_history with the new rolling average.
 */
export async function finalizeSessionScore(sessionId: string): Promise<SessionScoreResult> {
  // Get all events for this session
  const { rows: events } = await db.query(
    `SELECT event_type, penalty_points, speed_kph, speed_limit_kph, mph_over,
            speed_severity, g_force, lat, lng, recorded_at
     FROM driving_events WHERE session_id = $1 ORDER BY recorded_at`,
    [sessionId]
  );

  // Get driver_id from delivery_sessions
  const { rows: [session] } = await db.query(
    'SELECT driver_id FROM delivery_sessions WHERE id = $1',
    [sessionId]
  );
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const speedPenalties   = events.filter(e => e.event_type === 'speed_violation').map((e: any) => e.penalty_points);
  const brakingPenalties = events.filter(e => ['harsh_braking','rapid_acceleration'].includes(e.event_type)).map((e: any) => e.penalty_points);

  const result = computeSessionScore(speedPenalties, brakingPenalties);

  // Build breakdown JSONB
  const breakdown = {
    speed_violations:   { count: result.speed_violations,   penalty_points: result.speed_penalty },
    harsh_braking:      { count: result.braking_violations, penalty_points: result.braking_penalty },
    session_score:      result.final_score,
    events: events.map((e: any) => ({
      type: e.event_type,
      severity: e.speed_severity ?? null,
      mph_over: e.mph_over ? parseFloat(e.mph_over) : null,
      g_force:  e.g_force  ? parseFloat(e.g_force) : null,
      penalty:  e.penalty_points,
      lat: e.lat ? parseFloat(e.lat) : null,
      lng: e.lng ? parseFloat(e.lng) : null,
      ts: e.recorded_at,
    })),
  };

  // Upsert session_scores
  await db.query(
    `INSERT INTO session_scores
       (session_id, driver_id, speed_penalty, braking_penalty, final_score,
        speed_violations, braking_violations, event_count, breakdown)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (session_id) DO UPDATE SET
       speed_penalty = EXCLUDED.speed_penalty,
       braking_penalty = EXCLUDED.braking_penalty,
       final_score = EXCLUDED.final_score,
       speed_violations = EXCLUDED.speed_violations,
       braking_violations = EXCLUDED.braking_violations,
       event_count = EXCLUDED.event_count,
       breakdown = EXCLUDED.breakdown,
       calculated_at = NOW()`,
    [sessionId, session.driver_id,
     result.speed_penalty, result.braking_penalty, result.final_score,
     result.speed_violations, result.braking_violations, result.event_count,
     JSON.stringify(breakdown)]
  );

  // Update rolling score
  await updateRollingScore(session.driver_id);

  return result;
}

/**
 * Recompute and store the rolling score for a driver.
 */
export async function updateRollingScore(driverId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT final_score FROM session_scores
     WHERE driver_id = $1
     ORDER BY calculated_at DESC
     LIMIT 20`,
    [driverId]
  );

  const scores = rows.map((r: any) => r.final_score);
  const rolling = calculateRollingScore(scores);

  await db.query(
    `INSERT INTO score_history (driver_id, weighted_avg, sessions_counted)
     VALUES ($1, $2, $3)`,
    [driverId, rolling, scores.length]
  );

  return rolling;
}

/**
 * Get the latest rolling score for a driver.
 */
export async function getDriverRollingScore(driverId: string): Promise<{
  rolling_score: number | null;
  sessions_counted: number;
  tier: string;
}> {
  const { rows: [latest] } = await db.query(
    `SELECT weighted_avg, sessions_counted FROM score_history
     WHERE driver_id = $1
     ORDER BY computed_at DESC LIMIT 1`,
    [driverId]
  );

  if (!latest) {
    return { rolling_score: null, sessions_counted: 0, tier: 'Not enough data' };
  }

  const score = parseFloat(latest.weighted_avg);
  return {
    rolling_score: score,
    sessions_counted: latest.sessions_counted,
    tier: scoreTier(score),
  };
}

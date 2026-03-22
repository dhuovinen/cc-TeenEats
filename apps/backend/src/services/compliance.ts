/**
 * Compliance Engine — MVP Module 4
 *
 * Enforces minor labor law (16–17 year olds) hour caps and curfews per state.
 * Reference: docs/compliance.md
 *
 * Design: pure evaluation functions + thin DB wrapper.
 *   Pure functions are unit-testable without DB.
 *   DB functions are integration-tested via /compliance routes.
 */
import { db } from '../db';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceRule {
  state: string;
  daily_school_day_minutes: number | null;
  daily_nonschool_day_minutes: number | null;
  weekly_school_week_minutes: number | null;
  weekly_summer_minutes: number | null;
  school_night_end_time: string | null;   // "HH:MM"
  nonschool_night_end_time: string | null; // "HH:MM"
  day_start_time: string | null;          // "HH:MM"
  notes: string | null;
}

export interface ComplianceResult {
  allowed: boolean;
  reason: string | null;
  violation_type: 'daily_cap' | 'weekly_cap' | 'curfew' | 'start_time' | null;
  daily_minutes_used: number;
  daily_minutes_limit: number | null;
  weekly_minutes_used: number;
  weekly_minutes_limit: number | null;
  curfew_end: string | null; // "HH:MM" of today's applicable curfew
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Is this date within the school year?
 * Summer = June 1 through first Monday of September (Labor Day).
 * School year = everything else (Sep after Labor Day through May 31).
 */
export function isSchoolYear(date: Date): boolean {
  const month = date.getUTCMonth(); // 0-indexed
  const day = date.getUTCDate();

  if (month < 5) return true;   // Jan–May → school year
  if (month === 5) return false; // June → summer
  if (month >= 6 && month <= 7) return false; // July–Aug → summer
  if (month === 8) {
    // September: summer until after Labor Day (first Monday)
    const laborDay = getFirstMondayOfSeptemberUTC(date.getUTCFullYear());
    return day > laborDay;
  }
  return true; // Oct–Dec → school year
}

function getFirstMondayOfSeptemberUTC(year: number): number {
  // Find the first Monday of September in UTC
  const sept1 = new Date(Date.UTC(year, 8, 1)); // Sept 1
  const dow = sept1.getUTCDay(); // 0=Sun, 1=Mon, ...
  // Days until next Monday (or same day if Monday)
  const offset = dow === 1 ? 0 : (8 - dow) % 7;
  return 1 + offset;
}

/**
 * Is today a school day (Mon–Fri during school year)?
 * Weekend days and summer days are "non-school days" with higher/no caps.
 */
export function isSchoolDay(date: Date): boolean {
  if (!isSchoolYear(date)) return false;
  const dow = date.getUTCDay(); // 0=Sun, 6=Sat
  return dow >= 1 && dow <= 5;
}

/**
 * Is tonight a "school night"?
 * School nights (Sunday–Thursday evenings during school year) have earlier curfews.
 * The curfew applies to the evening/night of that day.
 */
export function isSchoolNight(date: Date): boolean {
  if (!isSchoolYear(date)) return false;
  const dow = date.getUTCDay();
  // Sun(0) Mon(1) Tue(2) Wed(3) Thu(4) are school nights
  return dow >= 0 && dow <= 4;
}

/**
 * Get start of ISO week (Monday) for a given date in UTC.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon
  const diff = (dow === 0 ? -6 : 1 - dow); // adjust to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Parse "HH:MM" time string into { hour, minute }.
 */
export function parseTime(t: string): { hour: number; minute: number } {
  const [h, m] = t.split(':').map(Number);
  return { hour: h, minute: m };
}

/**
 * Get total minutes since midnight UTC for a Date.
 */
export function minutesSinceMidnight(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/**
 * Core rule evaluation — pure, no DB.
 *
 * @param rule       - State-specific compliance rule
 * @param dailyMins  - Minutes already worked today
 * @param weeklyMins - Minutes already worked this week
 * @param now        - Current datetime (used for curfew + school-day detection)
 */
export function evaluateCompliance(
  rule: ComplianceRule,
  dailyMins: number,
  weeklyMins: number,
  now: Date,
): ComplianceResult {
  const schoolDay = isSchoolDay(now);
  const schoolNight = isSchoolNight(now);
  const summer = !isSchoolYear(now);

  // Determine applicable caps
  const dailyLimit = schoolDay
    ? rule.daily_school_day_minutes
    : rule.daily_nonschool_day_minutes;

  const weeklyLimit = summer
    ? rule.weekly_summer_minutes
    : rule.weekly_school_week_minutes;

  // Determine applicable curfew
  const curfewStr = schoolNight
    ? rule.school_night_end_time
    : rule.nonschool_night_end_time;

  const base: Omit<ComplianceResult, 'allowed' | 'reason' | 'violation_type'> = {
    daily_minutes_used: dailyMins,
    daily_minutes_limit: dailyLimit,
    weekly_minutes_used: weeklyMins,
    weekly_minutes_limit: weeklyLimit,
    curfew_end: curfewStr,
  };

  // Check curfew first (time-of-day block)
  if (curfewStr !== null) {
    const { hour: ch, minute: cm } = parseTime(curfewStr);
    const curfewMins = ch * 60 + cm;
    const nowMins = minutesSinceMidnight(now);

    // Midnight-crossing curfews (hour < 5, e.g. "00:30"):
    //   - Applies only in early morning (midnight to ~5am)
    //   - 11pm is NOT past a "00:30" curfew; 12:45am IS past it
    //   - "00:00" midnight curfew: blocked at exactly midnight onward (early hours)
    // Regular curfews (hour >= 5, e.g. "22:00"): blocked from that hour onward
    let pastCurfew: boolean;
    if (ch < 5) {
      // Midnight-crossing curfew: only apply check when we're in early morning (0:00–5:00)
      pastCurfew = nowMins <= 5 * 60 && nowMins >= curfewMins;
    } else {
      pastCurfew = nowMins >= curfewMins;
    }

    if (pastCurfew) {
      return {
        ...base,
        allowed: false,
        reason: `Curfew: must stop by ${curfewStr} (${schoolNight ? 'school night' : 'non-school night'})`,
        violation_type: 'curfew',
      };
    }
  }

  // Check day-start restriction
  if (rule.day_start_time !== null) {
    const { hour: sh, minute: sm } = parseTime(rule.day_start_time);
    const startMins = sh * 60 + sm;
    const nowMins = minutesSinceMidnight(now);
    if (nowMins < startMins) {
      return {
        ...base,
        allowed: false,
        reason: `Cannot work before ${rule.day_start_time}`,
        violation_type: 'start_time',
      };
    }
  }

  // Check daily cap
  if (dailyLimit !== null && dailyMins >= dailyLimit) {
    return {
      ...base,
      allowed: false,
      reason: `Daily hour cap reached: ${dailyMins} / ${dailyLimit} minutes (${schoolDay ? 'school day' : 'non-school day'})`,
      violation_type: 'daily_cap',
    };
  }

  // Check weekly cap
  if (weeklyLimit !== null && weeklyMins >= weeklyLimit) {
    return {
      ...base,
      allowed: false,
      reason: `Weekly hour cap reached: ${weeklyMins} / ${weeklyLimit} minutes (${summer ? 'summer' : 'school week'})`,
      violation_type: 'weekly_cap',
    };
  }

  return {
    ...base,
    allowed: true,
    reason: null,
    violation_type: null,
  };
}

// ─── DB-backed functions ──────────────────────────────────────────────────────

export async function getComplianceRule(state: string): Promise<ComplianceRule | null> {
  const { rows } = await db.query(
    'SELECT * FROM compliance_rules WHERE state = $1',
    [state.toUpperCase()]
  );
  return rows[0] || null;
}

export async function getWorkMinutes(
  driverId: string,
  now: Date,
): Promise<{ daily: number; weekly: number }> {
  const todayStr = now.toISOString().slice(0, 10);
  const weekStart = getWeekStart(now);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const { rows } = await db.query(
    `SELECT
       SUM(CASE WHEN work_date = $2 THEN minutes_worked ELSE 0 END) AS daily,
       SUM(CASE WHEN work_date >= $3 THEN minutes_worked ELSE 0 END) AS weekly
     FROM work_sessions
     WHERE driver_id = $1 AND work_date >= $3`,
    [driverId, todayStr, weekStartStr]
  );

  return {
    daily: parseInt(rows[0]?.daily ?? '0', 10),
    weekly: parseInt(rows[0]?.weekly ?? '0', 10),
  };
}

export async function canStartSession(
  driverId: string,
  now: Date = new Date(),
): Promise<ComplianceResult> {
  // Get driver's state
  const { rows: [profile] } = await db.query(
    `SELECT state FROM driver_profiles WHERE user_id = $1`,
    [driverId]
  );

  if (!profile?.state) {
    // No state on file — allow but log warning
    return {
      allowed: true,
      reason: null,
      violation_type: null,
      daily_minutes_used: 0,
      daily_minutes_limit: null,
      weekly_minutes_used: 0,
      weekly_minutes_limit: null,
      curfew_end: null,
    };
  }

  const rule = await getComplianceRule(profile.state);
  if (!rule) {
    // State not in compliance_rules — no restrictions (unknown state)
    return {
      allowed: true,
      reason: null,
      violation_type: null,
      daily_minutes_used: 0,
      daily_minutes_limit: null,
      weekly_minutes_used: 0,
      weekly_minutes_limit: null,
      curfew_end: null,
    };
  }

  const { daily, weekly } = await getWorkMinutes(driverId, now);
  return evaluateCompliance(rule, daily, weekly, now);
}

export async function recordWorkTime(
  driverId: string,
  minutes: number,
  date: Date = new Date(),
): Promise<void> {
  if (minutes <= 0) return;

  const { rows: [profile] } = await db.query(
    `SELECT state FROM driver_profiles WHERE user_id = $1`,
    [driverId]
  );
  const state = profile?.state ?? 'TX';
  const dateStr = date.toISOString().slice(0, 10);

  await db.query(
    `INSERT INTO work_sessions (driver_id, work_date, state, minutes_worked)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (driver_id, work_date)
     DO UPDATE SET minutes_worked = work_sessions.minutes_worked + EXCLUDED.minutes_worked,
                   updated_at = NOW()`,
    [driverId, dateStr, state, minutes]
  );
}

export async function logViolation(
  driverId: string,
  result: ComplianceResult,
  state: string,
): Promise<void> {
  if (!result.violation_type) return;
  await db.query(
    `INSERT INTO compliance_violations (driver_id, violation_type, rule_state, details)
     VALUES ($1, $2, $3, $4)`,
    [driverId, result.violation_type, state, JSON.stringify({
      reason: result.reason,
      daily_used: result.daily_minutes_used,
      daily_limit: result.daily_minutes_limit,
      weekly_used: result.weekly_minutes_used,
      weekly_limit: result.weekly_minutes_limit,
    })]
  );
}

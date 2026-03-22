/**
 * Unit tests — Compliance Engine pure functions
 *
 * Tests the pure evaluation logic (no DB, no HTTP).
 * Key states: CA (strict), NY (strict), TX (no limits).
 */
import {
  isSchoolYear,
  isSchoolDay,
  isSchoolNight,
  getWeekStart,
  evaluateCompliance,
  type ComplianceRule,
} from '../../services/compliance';

// ─── Test data ────────────────────────────────────────────────────────────────

const TX_RULE: ComplianceRule = {
  state: 'TX',
  daily_school_day_minutes: null,
  daily_nonschool_day_minutes: null,
  weekly_school_week_minutes: null,
  weekly_summer_minutes: null,
  school_night_end_time: null,
  nonschool_night_end_time: null,
  day_start_time: null,
  notes: 'No limits',
};

const CA_RULE: ComplianceRule = {
  state: 'CA',
  daily_school_day_minutes: 240,      // 4 hrs school day
  daily_nonschool_day_minutes: 480,   // 8 hrs non-school
  weekly_school_week_minutes: null,   // no explicit school-year weekly cap
  weekly_summer_minutes: 2880,        // 48 hrs summer
  school_night_end_time: '22:00',     // 10pm school nights
  nonschool_night_end_time: '00:30',  // 12:30am non-school nights
  day_start_time: '05:00',           // earliest 5am
  notes: '',
};

const NY_RULE: ComplianceRule = {
  state: 'NY',
  daily_school_day_minutes: 240,      // 4 hrs school day
  daily_nonschool_day_minutes: 480,   // 8 hrs non-school
  weekly_school_week_minutes: 1680,   // 28 hrs school week
  weekly_summer_minutes: 2880,        // 48 hrs summer
  school_night_end_time: '22:00',     // 10pm school nights
  nonschool_night_end_time: '00:00',  // midnight non-school nights
  day_start_time: null,
  notes: '',
};

// Helper to create a UTC date with specific components
function utcDate(year: number, month: number, day: number, hour = 10, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

// ─── isSchoolYear ─────────────────────────────────────────────────────────────

describe('isSchoolYear', () => {
  it('January is school year', () => {
    expect(isSchoolYear(utcDate(2025, 1, 15))).toBe(true);
  });

  it('May 31 is school year', () => {
    expect(isSchoolYear(utcDate(2025, 5, 31))).toBe(true);
  });

  it('June 1 is summer', () => {
    expect(isSchoolYear(utcDate(2025, 6, 1))).toBe(false);
  });

  it('July is summer', () => {
    expect(isSchoolYear(utcDate(2025, 7, 15))).toBe(false);
  });

  it('August is summer', () => {
    expect(isSchoolYear(utcDate(2025, 8, 31))).toBe(false);
  });

  it('September 1 (before Labor Day) is summer', () => {
    // Labor Day 2025 = Sept 1 (first Monday of September)
    expect(isSchoolYear(utcDate(2025, 9, 1))).toBe(false);
  });

  it('day after Labor Day 2025 (Sep 2) is school year', () => {
    // Labor Day 2025 = Sept 1; day after = Sept 2
    expect(isSchoolYear(utcDate(2025, 9, 2))).toBe(true);
  });

  it('October is school year', () => {
    expect(isSchoolYear(utcDate(2025, 10, 15))).toBe(true);
  });

  it('December is school year', () => {
    expect(isSchoolYear(utcDate(2025, 12, 25))).toBe(true);
  });
});

// ─── isSchoolDay ──────────────────────────────────────────────────────────────

describe('isSchoolDay', () => {
  it('Monday during school year is a school day', () => {
    const monday = utcDate(2025, 10, 6); // Mon Oct 6 2025
    expect(isSchoolDay(monday)).toBe(true);
  });

  it('Friday during school year is a school day', () => {
    const friday = utcDate(2025, 10, 10); // Fri Oct 10 2025
    expect(isSchoolDay(friday)).toBe(true);
  });

  it('Saturday during school year is NOT a school day', () => {
    const saturday = utcDate(2025, 10, 11);
    expect(isSchoolDay(saturday)).toBe(false);
  });

  it('Sunday during school year is NOT a school day', () => {
    const sunday = utcDate(2025, 10, 12);
    expect(isSchoolDay(sunday)).toBe(false);
  });

  it('Monday during summer is NOT a school day', () => {
    const monday = utcDate(2025, 7, 14);
    expect(isSchoolDay(monday)).toBe(false);
  });
});

// ─── isSchoolNight ────────────────────────────────────────────────────────────

describe('isSchoolNight', () => {
  it('Sunday during school year is a school night', () => {
    const sunday = utcDate(2025, 10, 5, 21); // Sun Oct 5 9pm
    expect(isSchoolNight(sunday)).toBe(true);
  });

  it('Thursday during school year is a school night', () => {
    const thursday = utcDate(2025, 10, 9, 21); // Thu Oct 9 9pm
    expect(isSchoolNight(thursday)).toBe(true);
  });

  it('Friday during school year is NOT a school night', () => {
    const friday = utcDate(2025, 10, 10, 21); // Fri Oct 10 9pm
    expect(isSchoolNight(friday)).toBe(false);
  });

  it('Saturday during school year is NOT a school night', () => {
    const saturday = utcDate(2025, 10, 11, 21);
    expect(isSchoolNight(saturday)).toBe(false);
  });

  it('Monday during summer is NOT a school night', () => {
    const monday = utcDate(2025, 7, 14, 21);
    expect(isSchoolNight(monday)).toBe(false);
  });
});

// ─── getWeekStart ─────────────────────────────────────────────────────────────

describe('getWeekStart', () => {
  it('Wednesday returns previous Monday', () => {
    const wed = utcDate(2025, 10, 8); // Wed Oct 8
    const start = getWeekStart(wed);
    expect(start.getUTCDate()).toBe(6); // Mon Oct 6
    expect(start.getUTCDay()).toBe(1);
  });

  it('Monday returns same day', () => {
    const mon = utcDate(2025, 10, 6);
    const start = getWeekStart(mon);
    expect(start.getUTCDate()).toBe(6);
  });

  it('Sunday returns previous Monday', () => {
    const sun = utcDate(2025, 10, 12);
    const start = getWeekStart(sun);
    expect(start.getUTCDate()).toBe(6); // Mon Oct 6
  });
});

// ─── evaluateCompliance — TX (no limits) ─────────────────────────────────────

describe('evaluateCompliance — TX (no limits)', () => {
  const schoolDayMorning = utcDate(2025, 10, 6, 10); // Mon Oct 6 10am

  it('TX: always allowed regardless of hours worked', () => {
    const result = evaluateCompliance(TX_RULE, 480, 2880, schoolDayMorning);
    expect(result.allowed).toBe(true);
    expect(result.violation_type).toBeNull();
  });

  it('TX: allowed even at 300 daily minutes (beyond any cap)', () => {
    const result = evaluateCompliance(TX_RULE, 300, 1000, schoolDayMorning);
    expect(result.allowed).toBe(true);
  });

  it('TX: allowed at curfew time because TX has no curfew', () => {
    const midnight = utcDate(2025, 10, 6, 23, 59);
    const result = evaluateCompliance(TX_RULE, 0, 0, midnight);
    expect(result.allowed).toBe(true);
  });
});

// ─── evaluateCompliance — CA ──────────────────────────────────────────────────

describe('evaluateCompliance — CA', () => {
  const schoolDayMorning = utcDate(2025, 10, 6, 10);  // Mon Oct 6 10am (school year)
  const schoolNightPast  = utcDate(2025, 10, 6, 22, 30); // Mon 10:30pm — past 10pm curfew
  const schoolNightBefore = utcDate(2025, 10, 6, 21, 0); // Mon 9pm — before curfew

  it('CA: allowed at 0 minutes on school morning', () => {
    const result = evaluateCompliance(CA_RULE, 0, 0, schoolDayMorning);
    expect(result.allowed).toBe(true);
    expect(result.daily_minutes_limit).toBe(240);
  });

  it('CA: blocked at daily cap (240 mins = 4hrs) on school day', () => {
    const result = evaluateCompliance(CA_RULE, 240, 240, schoolDayMorning);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('daily_cap');
  });

  it('CA: allowed at 239 minutes on school day (one minute under cap)', () => {
    const result = evaluateCompliance(CA_RULE, 239, 239, schoolDayMorning);
    expect(result.allowed).toBe(true);
  });

  it('CA: blocked past 10pm school night curfew', () => {
    const result = evaluateCompliance(CA_RULE, 0, 0, schoolNightPast);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('curfew');
    expect(result.reason).toMatch(/10pm|22:00|curfew/i);
  });

  it('CA: allowed at 9pm on school night (before 10pm curfew)', () => {
    const result = evaluateCompliance(CA_RULE, 0, 0, schoolNightBefore);
    expect(result.allowed).toBe(true);
  });

  it('CA: blocked before 5am start restriction', () => {
    const earlyMorning = utcDate(2025, 10, 6, 4, 30); // 4:30am
    const result = evaluateCompliance(CA_RULE, 0, 0, earlyMorning);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('start_time');
  });

  it('CA: allowed exactly at 5am start time', () => {
    const fiveAm = utcDate(2025, 10, 6, 5, 0);
    const result = evaluateCompliance(CA_RULE, 0, 0, fiveAm);
    expect(result.allowed).toBe(true);
  });

  it('CA: non-school day has 480 min (8hr) cap', () => {
    const saturday = utcDate(2025, 10, 11, 10); // Sat — non-school
    const result = evaluateCompliance(CA_RULE, 479, 479, saturday);
    expect(result.allowed).toBe(true);
    expect(result.daily_minutes_limit).toBe(480);
  });

  it('CA: summer weekly cap (2880 = 48hrs) blocks when reached', () => {
    const summerMon = utcDate(2025, 7, 14, 10);
    const result = evaluateCompliance(CA_RULE, 0, 2880, summerMon);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('weekly_cap');
  });

  it('CA: midnight-crossing curfew: 12:45am blocked on non-school night', () => {
    // CA non-school night curfew = 00:30; 12:45am is past it
    const friday = utcDate(2025, 10, 10, 0, 45); // Fri 12:45am (non-school night)
    const result = evaluateCompliance(CA_RULE, 0, 0, friday);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('curfew');
  });

  it('CA: 11pm on Friday (non-school night) is before 00:30 curfew → allowed', () => {
    const friday11pm = utcDate(2025, 10, 10, 23, 0);
    const result = evaluateCompliance(CA_RULE, 0, 0, friday11pm);
    expect(result.allowed).toBe(true);
  });
});

// ─── evaluateCompliance — NY ──────────────────────────────────────────────────

describe('evaluateCompliance — NY', () => {
  const schoolDayMorning = utcDate(2025, 10, 6, 10); // Mon school day

  it('NY: blocked at weekly school cap (1680 = 28hrs)', () => {
    const result = evaluateCompliance(NY_RULE, 0, 1680, schoolDayMorning);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('weekly_cap');
  });

  it('NY: allowed at 1679 weekly minutes (one under cap)', () => {
    const result = evaluateCompliance(NY_RULE, 0, 1679, schoolDayMorning);
    expect(result.allowed).toBe(true);
  });

  it('NY: blocked at daily school cap (240 mins)', () => {
    const result = evaluateCompliance(NY_RULE, 240, 240, schoolDayMorning);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('daily_cap');
  });

  it('NY: school night curfew 10pm blocks at 10:01pm', () => {
    const past10pm = utcDate(2025, 10, 6, 22, 1);
    const result = evaluateCompliance(NY_RULE, 0, 0, past10pm);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('curfew');
  });

  it('NY: non-school night midnight blocks at exactly midnight', () => {
    const friday = utcDate(2025, 10, 10, 0, 0); // Fri midnight
    const result = evaluateCompliance(NY_RULE, 0, 0, friday);
    expect(result.allowed).toBe(false);
    expect(result.violation_type).toBe('curfew');
  });

  it('NY: summer applies weekly_summer_minutes (2880) not school cap', () => {
    const summerMon = utcDate(2025, 7, 14, 10);
    // 1680 weekly — would be blocked in school year but not in summer (cap is 2880)
    const result = evaluateCompliance(NY_RULE, 0, 1680, summerMon);
    expect(result.allowed).toBe(true);
    expect(result.weekly_minutes_limit).toBe(2880);
  });
});

// ─── Result structure ─────────────────────────────────────────────────────────

describe('evaluateCompliance result structure', () => {
  it('returns correct metadata on allowed result', () => {
    const result = evaluateCompliance(TX_RULE, 100, 500, utcDate(2025, 10, 6, 10));
    expect(result).toMatchObject({
      allowed: true,
      reason: null,
      violation_type: null,
      daily_minutes_used: 100,
      weekly_minutes_used: 500,
      daily_minutes_limit: null,
      weekly_minutes_limit: null,
    });
  });

  it('returns correct metadata on blocked result', () => {
    const mon = utcDate(2025, 10, 6, 10);
    const result = evaluateCompliance(CA_RULE, 240, 500, mon);
    expect(result).toMatchObject({
      allowed: false,
      violation_type: 'daily_cap',
      daily_minutes_used: 240,
      daily_minutes_limit: 240,
    });
    expect(result.reason).toBeTruthy();
  });
});

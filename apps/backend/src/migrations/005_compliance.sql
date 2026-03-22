-- Module 4: Compliance Engine
-- Enforces minor labor law hour caps and curfews per state.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '005_compliance.sql') THEN

    -- Per-state rules. All times stored as UTC hour offset from local.
    -- Simplified: times stored in local clock hours (HH:MM), applied in driver's state tz.
    -- MVP applies UTC approximations; full tz support is post-MVP.
    CREATE TABLE compliance_rules (
      state                         CHAR(2)  PRIMARY KEY,
      -- Daily limits (minutes)
      daily_school_day_minutes      INTEGER,   -- school day cap (NULL = no cap)
      daily_nonschool_day_minutes   INTEGER,   -- non-school / weekend day cap (NULL = no cap)
      -- Weekly limits (minutes)
      weekly_school_week_minutes    INTEGER,   -- school week cap (NULL = no cap)
      weekly_summer_minutes         INTEGER,   -- summer week cap (NULL = no cap)
      -- Time-of-day restrictions (stored as HH:MM strings in local time)
      school_night_end_time         TIME,      -- latest allowed on school nights (NULL = no restriction)
      nonschool_night_end_time      TIME,      -- latest allowed on non-school nights (NULL = no restriction)
      day_start_time                TIME,      -- earliest allowed to start (NULL = no restriction)
      -- Metadata
      notes                         TEXT,
      updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Work session records: one row per driver per day
    CREATE TABLE work_sessions (
      id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id     UUID     NOT NULL REFERENCES users(id),
      work_date     DATE     NOT NULL,
      state         CHAR(2)  NOT NULL,
      minutes_worked INTEGER  NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(driver_id, work_date)
    );

    -- Audit log of compliance blocks
    CREATE TABLE compliance_violations (
      id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id       UUID     NOT NULL REFERENCES users(id),
      violation_type  TEXT     NOT NULL
                        CHECK (violation_type IN ('daily_cap','weekly_cap','curfew','start_time')),
      rule_state      CHAR(2)  NOT NULL,
      details         JSONB,
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_work_sessions_driver_date ON work_sessions(driver_id, work_date);
    CREATE INDEX idx_compliance_violations_driver ON compliance_violations(driver_id);

    -- ─── Seed compliance rules ────────────────────────────────────────────────
    -- Sources: docs/compliance.md

    -- Texas: 16-17 unlimited hours (FLSA baseline); no state-specific rules
    INSERT INTO compliance_rules
      (state, daily_school_day_minutes, daily_nonschool_day_minutes,
       weekly_school_week_minutes, weekly_summer_minutes,
       school_night_end_time, nonschool_night_end_time, day_start_time, notes)
    VALUES
      ('TX', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       'Texas defers to FLSA. No daily/weekly/curfew limits for 16-17.');

    -- California: most restrictive state
    -- 4 hrs/school day, 8 hrs non-school; 48 hrs/week summer (with permit)
    -- Curfew: 10pm school nights, 12:30am non-school nights; earliest 5am
    INSERT INTO compliance_rules
      (state, daily_school_day_minutes, daily_nonschool_day_minutes,
       weekly_school_week_minutes, weekly_summer_minutes,
       school_night_end_time, nonschool_night_end_time, day_start_time, notes)
    VALUES
      ('CA', 240, 480, NULL, 2880, '22:00', '00:30', '05:00',
       'California Ed Code + Labor Code. Work permit required. 4hr school day cap.');

    -- New York: 4 hrs/school day, 28 hrs/school week, 48 hrs summer
    -- Curfew: 10pm school nights, midnight non-school nights
    INSERT INTO compliance_rules
      (state, daily_school_day_minutes, daily_nonschool_day_minutes,
       weekly_school_week_minutes, weekly_summer_minutes,
       school_night_end_time, nonschool_night_end_time, day_start_time, notes)
    VALUES
      ('NY', 240, 480, 1680, 2880, '22:00', '00:00', NULL,
       'NY Labor Law §131-133. Work permit (Employment Certificate) required.');

    -- Florida: 8 hrs non-school day, 30 hrs/school week
    -- Curfew: 11pm school nights, 11:30pm Fri/Sat
    INSERT INTO compliance_rules
      (state, daily_school_day_minutes, daily_nonschool_day_minutes,
       weekly_school_week_minutes, weekly_summer_minutes,
       school_night_end_time, nonschool_night_end_time, day_start_time, notes)
    VALUES
      ('FL', 480, 480, 1800, NULL, '23:00', '23:30', NULL,
       'Florida Child Labor Law §450. Work permit (Form DH 681) required.');

    -- Illinois: 8 hrs non-school day, 24 hrs/school week, 48 hrs summer
    -- Curfew: 10pm school nights, midnight Fri/Sat
    INSERT INTO compliance_rules
      (state, daily_school_day_minutes, daily_nonschool_day_minutes,
       weekly_school_week_minutes, weekly_summer_minutes,
       school_night_end_time, nonschool_night_end_time, day_start_time, notes)
    VALUES
      ('IL', 480, 480, 1440, 2880, '22:00', '00:00', NULL,
       'Illinois Child Labor Law 820 ILCS 205. 24 hr/week school-year cap.');

    -- Washington: 4 hrs/school day, 20 hrs/school week, 40 hrs summer
    -- Curfew: 10pm school nights
    INSERT INTO compliance_rules
      (state, daily_school_day_minutes, daily_nonschool_day_minutes,
       weekly_school_week_minutes, weekly_summer_minutes,
       school_night_end_time, nonschool_night_end_time, day_start_time, notes)
    VALUES
      ('WA', 240, 480, 1200, 2400, '22:00', '22:00', NULL,
       'WA Dept of Labor & Industries. 20 hr/school week is most restrictive in US.');

    INSERT INTO schema_migrations (filename) VALUES ('005_compliance.sql');
  END IF;
END $$;

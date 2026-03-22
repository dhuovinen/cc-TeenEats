-- Module 5: Safety Scoring v1
-- GPS speed events + accelerometer harsh braking → per-session score 0–100
-- Reference: docs/scoring.md

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '006_scoring_v1.sql') THEN

    -- Individual driving events submitted by the driver app during a session
    CREATE TABLE driving_events (
      id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id      UUID     NOT NULL REFERENCES delivery_sessions(id) ON DELETE CASCADE,
      driver_id       UUID     NOT NULL REFERENCES users(id),
      event_type      TEXT     NOT NULL
                        CHECK (event_type IN ('speed_violation', 'harsh_braking', 'rapid_acceleration')),
      -- Speed violation fields
      speed_kph       NUMERIC(6,2),       -- actual speed
      speed_limit_kph NUMERIC(6,2),       -- posted limit at location
      mph_over        NUMERIC(6,2),       -- (speed - limit) * 0.621371
      speed_severity  TEXT
                        CHECK (speed_severity IN ('low', 'medium', 'high', NULL)),
      -- Braking/acceleration fields
      g_force         NUMERIC(5,3),       -- peak g-force in event window
      -- Position
      lat             NUMERIC(9,6),
      lng             NUMERIC(9,6),
      -- Penalty applied for this event
      penalty_points  SMALLINT NOT NULL DEFAULT 0,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Computed per-session score (written when session is finalized)
    CREATE TABLE session_scores (
      session_id          UUID     PRIMARY KEY REFERENCES delivery_sessions(id),
      driver_id           UUID     NOT NULL REFERENCES users(id),
      base_score          SMALLINT NOT NULL DEFAULT 100,
      speed_penalty       SMALLINT NOT NULL DEFAULT 0,
      braking_penalty     SMALLINT NOT NULL DEFAULT 0,
      final_score         SMALLINT NOT NULL CHECK (final_score BETWEEN 0 AND 100),
      speed_violations    SMALLINT NOT NULL DEFAULT 0,
      braking_violations  SMALLINT NOT NULL DEFAULT 0,
      event_count         SMALLINT NOT NULL DEFAULT 0,
      breakdown           JSONB,       -- full event-level detail for parent dashboard
      calculated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Rolling score snapshot per driver (updated after each session finalized)
    CREATE TABLE score_history (
      id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id        UUID     NOT NULL REFERENCES users(id),
      weighted_avg     NUMERIC(5,2) NOT NULL CHECK (weighted_avg BETWEEN 0 AND 100),
      sessions_counted SMALLINT NOT NULL,
      computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_driving_events_session ON driving_events(session_id);
    CREATE INDEX idx_driving_events_driver  ON driving_events(driver_id);
    CREATE INDEX idx_session_scores_driver  ON session_scores(driver_id);
    CREATE INDEX idx_score_history_driver   ON score_history(driver_id, computed_at DESC);

    INSERT INTO schema_migrations (filename) VALUES ('006_scoring_v1.sql');
  END IF;
END $$;

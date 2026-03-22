-- Module 6: Payouts + Earnings v1
-- Per-session earnings (70/30 split, score-based bonus) + batch payouts

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '007_payouts_v1.sql') THEN

    -- Add delivery fee to delivery_sessions (in cents, default $8.00)
    ALTER TABLE delivery_sessions
      ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 800
        CHECK (delivery_fee_cents >= 0);

    -- Per-session earnings record (created at deliver time, async like scoring)
    CREATE TABLE session_earnings (
      session_id          UUID PRIMARY KEY REFERENCES delivery_sessions(id) ON DELETE CASCADE,
      driver_id           UUID NOT NULL REFERENCES users(id),
      delivery_fee_cents  INTEGER NOT NULL CHECK (delivery_fee_cents >= 0),
      rolling_score_used  NUMERIC(5,2) NOT NULL CHECK (rolling_score_used BETWEEN 0 AND 100),
      base_pay_cents      INTEGER NOT NULL CHECK (base_pay_cents >= 0),
      bonus_pay_cents     INTEGER NOT NULL CHECK (bonus_pay_cents >= 0),
      driver_pay_cents    INTEGER NOT NULL CHECK (driver_pay_cents >= 0),
      platform_cut_cents  INTEGER NOT NULL CHECK (platform_cut_cents >= 0),
      status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','paid','cancelled')),
      payout_id           UUID,                    -- FK added after payouts table created
      calculated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Batch payout records (weekly or admin-triggered)
    CREATE TABLE payouts (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id           UUID NOT NULL REFERENCES users(id),
      period_start        DATE NOT NULL,
      period_end          DATE NOT NULL,
      sessions_count      SMALLINT NOT NULL DEFAULT 0,
      total_cents         INTEGER NOT NULL CHECK (total_cents >= 0),
      status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','processing','paid','failed')),
      stripe_transfer_id  TEXT,
      initiated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at             TIMESTAMPTZ,
      failed_reason       TEXT
    );

    -- Now add the FK from session_earnings → payouts
    ALTER TABLE session_earnings
      ADD CONSTRAINT fk_session_earnings_payout
        FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;

    CREATE INDEX idx_session_earnings_driver  ON session_earnings(driver_id);
    CREATE INDEX idx_session_earnings_status  ON session_earnings(status);
    CREATE INDEX idx_payouts_driver_id        ON payouts(driver_id);
    CREATE INDEX idx_payouts_status           ON payouts(status);

    -- Default delivery fee setting (cents)
    INSERT INTO settings (key, value)
      VALUES ('default_delivery_fee_cents', '800')
      ON CONFLICT (key) DO NOTHING;

    INSERT INTO schema_migrations (filename) VALUES ('007_payouts_v1.sql');
  END IF;
END $$;

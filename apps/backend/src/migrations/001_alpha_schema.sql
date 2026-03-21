-- TeenEats Alpha Schema
-- Run via: npm --workspace apps/backend run migrate

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Drivers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'offline'
                CHECK (status IN ('offline', 'online', 'busy')),
  safety_score  NUMERIC(5,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);

-- ─── Deliveries ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_address    TEXT NOT NULL,
  pickup_lat        DOUBLE PRECISION NOT NULL,
  pickup_lng        DOUBLE PRECISION NOT NULL,
  dropoff_address   TEXT NOT NULL,
  dropoff_lat       DOUBLE PRECISION NOT NULL,
  dropoff_lng       DOUBLE PRECISION NOT NULL,
  item_description  TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending', 'assigned', 'active',
                      'completed', 'timed_out', 'cancelled'
                    )),
  driver_id         UUID REFERENCES drivers(id),
  timeout_seconds   INT NOT NULL DEFAULT 60,
  estimated_minutes NUMERIC(6,1) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  timed_out_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deliveries_status    ON deliveries (status);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver_id ON deliveries (driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_created   ON deliveries (created_at DESC);

-- ─── Location Events ──────────────────────────────────────────────────────────
-- GPS pings from driver during active delivery (foreground only; screen must stay on)
CREATE TABLE IF NOT EXISTS location_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_events_delivery ON location_events (delivery_id);
CREATE INDEX IF NOT EXISTS idx_location_events_ts       ON location_events (ts DESC);

-- ─── Delivery Scores ──────────────────────────────────────────────────────────
-- One row per (driver, delivery) for every delivery broadcast to that driver.
-- Used to calculate acceptance rate, on-time rate, and completion rate.
CREATE TABLE IF NOT EXISTS delivery_scores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  accepted    BOOLEAN NOT NULL DEFAULT false,
  on_time     BOOLEAN,         -- NULL until delivery is completed
  completed   BOOLEAN,         -- NULL until accepted delivery resolves
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_scores_driver ON delivery_scores (driver_id);

-- ─── Settings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Default Settings ─────────────────────────────────────────────────────────
INSERT INTO settings (key, value)
VALUES ('request_timeout_seconds', '60')
ON CONFLICT (key) DO NOTHING;

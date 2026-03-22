-- Migration 003: Restaurant & Menu Management (MVP Module 2)

-- ─── Restaurants ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS restaurants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  address         TEXT NOT NULL,
  lat             NUMERIC(9,6) NOT NULL,
  lng             NUMERIC(9,6) NOT NULL,
  phone           TEXT,
  cuisine_type    TEXT NOT NULL,
  image_url       TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS restaurants_active_idx    ON restaurants (active);
CREATE INDEX IF NOT EXISTS restaurants_cuisine_idx   ON restaurants (cuisine_type);

-- ─── Restaurant hours ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS restaurant_hours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  open_time       TIME NOT NULL,   -- local time, e.g. '11:00'
  close_time      TIME NOT NULL,
  UNIQUE (restaurant_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS restaurant_hours_rest_idx ON restaurant_hours (restaurant_id);

-- ─── Menu categories ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  display_order   SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_categories_rest_idx ON menu_categories (restaurant_id);

-- ─── Menu items ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  available       BOOLEAN NOT NULL DEFAULT TRUE,
  image_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_items_category_idx    ON menu_items (category_id);
CREATE INDEX IF NOT EXISTS menu_items_restaurant_idx  ON menu_items (restaurant_id);
CREATE INDEX IF NOT EXISTS menu_items_available_idx   ON menu_items (available);

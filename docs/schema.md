# TeenEats: Database Schema

PostgreSQL is the primary data store. Redis handles caching, pub/sub, and leaderboard operations (see [Redis Keys](#redis-keys) below).

---

## Tables

### `users`
Core identity record for all account types.

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('driver', 'customer', 'parent', 'admin')),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role  ON users (role);
```

---

### `drivers`
Extended profile for teen drivers. Linked 1:1 to `users`.

```sql
CREATE TABLE drivers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dob             DATE NOT NULL,
  state           TEXT NOT NULL,               -- home state, used for compliance rules
  license_state   TEXT NOT NULL,
  license_number  TEXT,                        -- stored encrypted
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'suspended', 'banned')),
  safety_score    NUMERIC(5,2) DEFAULT 100.0,  -- rolling score 0–100
  level           INT NOT NULL DEFAULT 1,      -- gamification level (post-MVP)
  badges          TEXT[] NOT NULL DEFAULT '{}',
  stripe_account_id TEXT,                      -- Stripe Connect Express account ID
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX idx_drivers_user_id ON drivers (user_id);
CREATE INDEX idx_drivers_status  ON drivers (status);
```

---

### `parents`
Links a parent account to one or more driver accounts (parent may have multiple teen children).

```sql
CREATE TABLE parents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id          UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  consent_status     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (consent_status IN ('pending', 'signed', 'revoked')),
  consent_signed_at  TIMESTAMPTZ,
  consent_ip         INET,                     -- IP at time of consent signature
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, driver_id)
);

CREATE INDEX idx_parents_driver_id ON parents (driver_id);
```

---

### `restaurants`
Restaurant partner profiles.

```sql
CREATE TABLE restaurants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  address           TEXT NOT NULL,
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,
  phone             TEXT,
  stripe_account_id TEXT,                      -- Stripe Connect account for restaurant payouts
  active            BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_restaurants_active ON restaurants (active);
-- Geospatial index for proximity queries (requires PostGIS or use lat/lng bounding box)
CREATE INDEX idx_restaurants_location ON restaurants (lat, lng);
```

---

### `menu_items`
Items offered by a restaurant.

```sql
CREATE TABLE menu_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  price_cents   INT NOT NULL CHECK (price_cents >= 0),
  available     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_menu_items_restaurant ON menu_items (restaurant_id);
```

---

### `orders`
Customer food orders. Central entity connecting customers, restaurants, and drivers.

```sql
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES users(id),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
  driver_id       UUID REFERENCES drivers(id),  -- NULL until assigned
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',      -- placed, waiting for restaurant confirmation
                    'confirmed',    -- restaurant confirmed, seeking driver
                    'assigned',     -- driver accepted
                    'picked_up',    -- driver has the food
                    'delivered',    -- delivery complete
                    'cancelled'
                  )),
  subtotal_cents  INT NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents INT NOT NULL DEFAULT 0,
  total_cents     INT NOT NULL CHECK (total_cents >= 0),
  delivery_address TEXT NOT NULL,
  delivery_lat    DOUBLE PRECISION NOT NULL,
  delivery_lng    DOUBLE PRECISION NOT NULL,
  special_instructions TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_customer_id   ON orders (customer_id);
CREATE INDEX idx_orders_driver_id     ON orders (driver_id);
CREATE INDEX idx_orders_restaurant_id ON orders (restaurant_id);
CREATE INDEX idx_orders_status        ON orders (status);
CREATE INDEX idx_orders_created_at    ON orders (created_at DESC);
```

---

### `order_items`
Line items for an order.

```sql
CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  UUID NOT NULL REFERENCES menu_items(id),
  quantity      INT NOT NULL CHECK (quantity > 0),
  unit_price_cents INT NOT NULL CHECK (unit_price_cents >= 0)
);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);
```

---

### `delivery_sessions`
Tracks a driver's active delivery from accept to complete. One session per order.

```sql
CREATE TABLE delivery_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id       UUID NOT NULL REFERENCES drivers(id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  route_polyline  TEXT,                        -- encoded Google Maps polyline for display
  distance_meters INT,                         -- total distance driven
  UNIQUE (order_id)
);

CREATE INDEX idx_delivery_sessions_driver_id ON delivery_sessions (driver_id);
CREATE INDEX idx_delivery_sessions_started   ON delivery_sessions (started_at DESC);
```

---

### `driving_events`
Raw telemetry events captured during a delivery session. High write volume — consider partitioning by month at scale.

```sql
CREATE TABLE driving_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES delivery_sessions(id) ON DELETE CASCADE,
  driver_id    UUID NOT NULL REFERENCES drivers(id),
  event_type   TEXT NOT NULL CHECK (event_type IN (
                 'speed_violation',
                 'harsh_braking',
                 'rapid_acceleration',
                 'sharp_cornering',
                 'phone_held'           -- post-MVP
               )),
  severity     TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  speed_mph    NUMERIC(5,1),            -- recorded speed at time of event (nullable)
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_driving_events_session_id ON driving_events (session_id);
CREATE INDEX idx_driving_events_driver_id  ON driving_events (driver_id);
CREATE INDEX idx_driving_events_ts         ON driving_events (ts DESC);
-- Partition by month at scale:
-- PARTITION BY RANGE (ts)
```

---

### `safety_scores`
Aggregated safety score per driver per period (session or weekly rollup).

```sql
CREATE TABLE safety_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      UUID NOT NULL REFERENCES drivers(id),
  period_type    TEXT NOT NULL CHECK (period_type IN ('session', 'weekly')),
  period_start   TIMESTAMPTZ NOT NULL,
  period_end     TIMESTAMPTZ NOT NULL,
  score          NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  breakdown      JSONB NOT NULL DEFAULT '{}',  -- {speed_violations: n, harsh_braking: n, ...}
  session_id     UUID REFERENCES delivery_sessions(id),  -- NULL for weekly rollups
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_safety_scores_driver_id    ON safety_scores (driver_id);
CREATE INDEX idx_safety_scores_period_start ON safety_scores (period_start DESC);
CREATE INDEX idx_safety_scores_session_id   ON safety_scores (session_id);
```

---

### `work_sessions`
Tracks cumulative hours worked per driver for compliance enforcement.

```sql
CREATE TABLE work_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(id),
  state           TEXT NOT NULL,               -- state law applied for this session
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,                 -- NULL = currently active
  hours_worked    NUMERIC(4,2),                -- computed on close
  week_start      DATE NOT NULL,               -- ISO week start (Monday) for weekly rollups
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_sessions_driver_id  ON work_sessions (driver_id);
CREATE INDEX idx_work_sessions_week_start ON work_sessions (driver_id, week_start);
```

---

### `payouts`
Records individual driver payouts. Each completed delivery generates one payout record.

```sql
CREATE TABLE payouts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           UUID NOT NULL REFERENCES drivers(id),
  order_id            UUID NOT NULL REFERENCES orders(id),
  session_id          UUID REFERENCES delivery_sessions(id),
  total_cents         INT NOT NULL CHECK (total_cents >= 0),  -- gross delivery fee
  base_cents          INT NOT NULL,                           -- base 70%
  bonus_cents         INT NOT NULL DEFAULT 0,                 -- safety score bonus up to 30%
  platform_cents      INT NOT NULL,                           -- platform cut
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  stripe_transfer_id  TEXT,                                   -- populated when paid
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_driver_id ON payouts (driver_id);
CREATE INDEX idx_payouts_status    ON payouts (status);
CREATE INDEX idx_payouts_paid_at   ON payouts (paid_at DESC);
```

---

### `notifications`
Audit log of all notifications sent. Useful for debugging and parent oversight reporting.

```sql
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  channel      TEXT NOT NULL CHECK (channel IN ('push', 'email', 'sms')),
  type         TEXT NOT NULL,                  -- e.g. 'order_assigned', 'safety_alert'
  payload      JSONB NOT NULL DEFAULT '{}',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  error        TEXT                            -- NULL = delivered successfully
);

CREATE INDEX idx_notifications_user_id ON notifications (user_id);
CREATE INDEX idx_notifications_sent_at ON notifications (sent_at DESC);
```

---

## Redis Keys

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `session:{user_id}` | Hash | 24h | JWT session data |
| `tracking:{driver_id}` | Hash | 5m sliding | Latest GPS coordinates (lat, lng, speed, ts) |
| `order:{order_id}:status` | String | 2h | Cached order status for real-time polling |
| `leaderboard:weekly` | Sorted Set | 7d | Driver safety score leaderboard (post-MVP) |
| `compliance:{driver_id}:week_hours` | String | 7d | Accumulated work hours this week |
| `rate_limit:{ip}` | String | 1m | API rate limiting counter |

---

## Notes

- All monetary values are stored in **cents** (integer) to avoid floating-point rounding.
- All timestamps use **TIMESTAMPTZ** to ensure UTC storage.
- `driving_events` will have the highest write throughput. Partition by month before 10M rows.
- `license_number` should be encrypted at the application layer (e.g. AES-256) before storage.

-- Module 3: Order Lifecycle
-- Full order state machine: placed → confirmed → ready_for_pickup → assigned → picked_up → delivered | cancelled

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '004_orders.sql') THEN

    CREATE TABLE orders (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id     UUID NOT NULL REFERENCES users(id),
      restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
      driver_id       UUID REFERENCES users(id),
      status          TEXT NOT NULL DEFAULT 'placed'
                        CHECK (status IN ('placed','confirmed','ready_for_pickup','assigned','picked_up','delivered','cancelled')),
      total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
      delivery_address TEXT NOT NULL,
      delivery_lat    NUMERIC(9,6),
      delivery_lng    NUMERIC(9,6),
      notes           TEXT,
      placed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at    TIMESTAMPTZ,
      ready_at        TIMESTAMPTZ,
      assigned_at     TIMESTAMPTZ,
      picked_up_at    TIMESTAMPTZ,
      delivered_at    TIMESTAMPTZ,
      cancelled_at    TIMESTAMPTZ,
      cancel_reason   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE order_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
      quantity        SMALLINT NOT NULL CHECK (quantity > 0),
      price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
      item_name       TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE delivery_sessions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id        UUID NOT NULL UNIQUE REFERENCES orders(id),
      driver_id       UUID NOT NULL REFERENCES users(id),
      started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      picked_up_at    TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      route_polyline  TEXT,
      distance_km     NUMERIC(8,3),
      duration_minutes INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_orders_customer_id    ON orders(customer_id);
    CREATE INDEX idx_orders_restaurant_id  ON orders(restaurant_id);
    CREATE INDEX idx_orders_driver_id      ON orders(driver_id);
    CREATE INDEX idx_orders_status         ON orders(status);
    CREATE INDEX idx_order_items_order_id  ON order_items(order_id);
    CREATE INDEX idx_delivery_sessions_driver ON delivery_sessions(driver_id);

    INSERT INTO schema_migrations (filename) VALUES ('004_orders.sql');
  END IF;
END $$;

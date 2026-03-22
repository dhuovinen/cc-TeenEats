/**
 * Integration tests — Module 3: Order Lifecycle
 *
 * Full order state machine:
 *   placed → confirmed → ready_for_pickup → assigned → picked_up → delivered
 *
 * Also tests: cancellation, race conditions, access control, validation.
 */
import request from 'supertest';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app } = buildApp();

// ─── Shared state ─────────────────────────────────────────────────────────────

let customerToken: string;
let customerToken2: string;
let driverToken: string;
let adminToken: string;
let restaurantId: string;
let menuItemId: string;
let menuItemId2: string;

async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/auth/v2/login')
    .send({ email, password });
  return res.body.accessToken;
}

async function placeOrder(token: string, overrides: object = {}): Promise<any> {
  const body = {
    restaurant_id: restaurantId,
    delivery_address: '123 Main St, Testville',
    items: [{ menu_item_id: menuItemId, quantity: 2 }],
    ...overrides,
  };
  return request(app).post('/orders').set('Authorization', `Bearer ${token}`).send(body);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await resetDb();

  // Register customer 1
  await request(app).post('/auth/v2/register/customer').send({
    full_name: 'Test Customer',
    email: 'customer@orders.test',
    password: 'Password123!',
  });
  customerToken = await loginAs('customer@orders.test', 'Password123!');

  // Register customer 2
  await request(app).post('/auth/v2/register/customer').send({
    full_name: 'Other Customer',
    email: 'customer2@orders.test',
    password: 'Password123!',
  });
  customerToken2 = await loginAs('customer2@orders.test', 'Password123!');

  // Register driver + manually consent-approve
  const driverRes = await request(app).post('/auth/v2/register/driver').send({
    full_name: 'Test Driver',
    email: 'driver@orders.test',
    password: 'Password123!',
    date_of_birth: '2006-01-01',
    state: 'TX',
    city: 'Austin',
    parent_email: 'parent@orders.test',
  });
  const emailToken = driverRes.body._dev?.emailVerifyToken;
  if (emailToken) await request(app).post(`/auth/v2/verify-email/${emailToken}`);
  // Auto-approve consent for test
  await db.query(
    `UPDATE driver_profiles SET consent_approved = TRUE WHERE user_id = (
      SELECT id FROM users WHERE email_lower = 'driver@orders.test'
    )`
  );
  driverToken = await loginAs('driver@orders.test', 'Password123!');

  // Create admin user directly in DB
  const bcrypt = await import('bcrypt');
  const adminHash = await bcrypt.hash('AdminPass123!', 1);
  await db.query(`
    INSERT INTO users (email, password_hash, role, full_name, email_verified, active)
    VALUES ('admin@orders.test', $1, 'admin', 'Test Admin', TRUE, TRUE)
  `, [adminHash]);
  const { rows: [adminUser] } = await db.query(
    `SELECT id FROM users WHERE email_lower = 'admin@orders.test'`
  );
  await db.query(
    `INSERT INTO admin_profiles (user_id) VALUES ($1)`,
    [adminUser.id]
  );
  adminToken = await loginAs('admin@orders.test', 'AdminPass123!');

  // Create a restaurant with menu items
  const restRes = await request(app)
    .post('/restaurants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Test Burger Joint',
      address: '456 Food St',
      lat: 30.2672,
      lng: -97.7431,
      cuisine_type: 'American',
    });
  restaurantId = restRes.body.restaurant.id;

  const catRes = await request(app)
    .post(`/restaurants/${restaurantId}/categories`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Burgers' });
  const categoryId = catRes.body.category.id;

  const item1Res = await request(app)
    .post(`/restaurants/${restaurantId}/items`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ category_id: categoryId, name: 'Classic Burger', price_cents: 899 });
  menuItemId = item1Res.body.item.id;

  const item2Res = await request(app)
    .post(`/restaurants/${restaurantId}/items`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ category_id: categoryId, name: 'Fries', price_cents: 299 });
  menuItemId2 = item2Res.body.item.id;
});

afterAll(async () => {
  await db.end();
});

// ─── 1. Place Order ───────────────────────────────────────────────────────────

describe('POST /orders — place order', () => {
  it('customer can place a valid order', async () => {
    const res = await placeOrder(customerToken);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      status: 'placed',
      restaurant_id: restaurantId,
      total_cents: 1798, // 899 * 2
    });
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.items[0].quantity).toBe(2);
  });

  it('calculates total_cents correctly for multi-item order', async () => {
    const res = await placeOrder(customerToken, {
      items: [
        { menu_item_id: menuItemId, quantity: 1 },
        { menu_item_id: menuItemId2, quantity: 3 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.order.total_cents).toBe(899 + 299 * 3); // 899 + 897 = 1796
  });

  it('rejects order with no items', async () => {
    const res = await placeOrder(customerToken, { items: [] });
    expect(res.status).toBe(400);
  });

  it('rejects order missing delivery_address', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ restaurant_id: restaurantId, items: [{ menu_item_id: menuItemId, quantity: 1 }] });
    expect(res.status).toBe(400);
  });

  it('rejects order with invalid menu_item_id', async () => {
    const res = await placeOrder(customerToken, {
      items: [{ menu_item_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid|unavailable/i);
  });

  it('rejects order with invalid restaurant_id', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        restaurant_id: '00000000-0000-0000-0000-000000000000',
        delivery_address: '123 Main St',
        items: [{ menu_item_id: menuItemId, quantity: 1 }],
      });
    expect(res.status).toBe(404);
  });

  it('rejects order with invalid quantity (0)', async () => {
    const res = await placeOrder(customerToken, {
      items: [{ menu_item_id: menuItemId, quantity: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it('requires customer role', async () => {
    const res = await placeOrder(driverToken);
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app)
      .post('/orders')
      .send({ restaurant_id: restaurantId, delivery_address: '123 Main St', items: [] });
    expect(res.status).toBe(401);
  });
});

// ─── 2. Get Order / My Orders ─────────────────────────────────────────────────

describe('GET /orders — order retrieval', () => {
  let orderId: string;

  beforeAll(async () => {
    const res = await placeOrder(customerToken);
    orderId = res.body.order.id;
  });

  it('customer can get their own order', async () => {
    const res = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(orderId);
    expect(res.body.order.items).toBeDefined();
  });

  it('customer cannot get another customer\'s order', async () => {
    const res = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken2}`);
    expect(res.status).toBe(403);
  });

  it('GET /orders/mine returns customer\'s orders', async () => {
    const res = await request(app)
      .get('/orders/mine')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body.orders.length).toBeGreaterThan(0);
    expect(res.body.orders.every((o: any) => o.restaurant_name)).toBe(true);
  });

  it('returns 404 for non-existent order', async () => {
    const res = await request(app)
      .get('/orders/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
  });
});

// ─── 3. Full Happy Path: placed → confirmed → ready → assigned → picked_up → delivered ───

describe('Full order lifecycle — happy path', () => {
  let orderId: string;

  beforeAll(async () => {
    const res = await placeOrder(customerToken);
    orderId = res.body.order.id;
  });

  it('admin can confirm a placed order', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('confirmed');
    expect(res.body.order.confirmed_at).toBeTruthy();
  });

  it('admin can mark confirmed order as ready_for_pickup', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/ready`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('ready_for_pickup');
    expect(res.body.order.ready_at).toBeTruthy();
  });

  it('driver can see available orders', async () => {
    const res = await request(app)
      .get('/orders/available')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    const found = res.body.orders.find((o: any) => o.id === orderId);
    expect(found).toBeDefined();
    expect(found.restaurant_name).toBe('Test Burger Joint');
  });

  it('driver can accept a ready_for_pickup order', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('assigned');
    expect(res.body.order.assigned_at).toBeTruthy();
  });

  it('delivery session is created on accept', async () => {
    const { rows } = await db.query(
      'SELECT * FROM delivery_sessions WHERE order_id = $1',
      [orderId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].driver_id).toBeTruthy();
  });

  it('driver can mark order as picked_up', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/pickup`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('picked_up');
    expect(res.body.order.picked_up_at).toBeTruthy();
  });

  it('delivery session picked_up_at is updated', async () => {
    const { rows } = await db.query(
      'SELECT * FROM delivery_sessions WHERE order_id = $1',
      [orderId]
    );
    expect(rows[0].picked_up_at).toBeTruthy();
  });

  it('driver can mark order as delivered', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ distance_km: 3.5, duration_minutes: 12 });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('delivered');
    expect(res.body.order.delivered_at).toBeTruthy();
  });

  it('delivery session completed_at, distance_km, duration_minutes are recorded', async () => {
    const { rows } = await db.query(
      'SELECT * FROM delivery_sessions WHERE order_id = $1',
      [orderId]
    );
    expect(rows[0].completed_at).toBeTruthy();
    expect(parseFloat(rows[0].distance_km)).toBe(3.5);
    expect(rows[0].duration_minutes).toBe(12);
  });
});

// ─── 4. State Transition Violations ──────────────────────────────────────────

describe('State transition violations', () => {
  let orderId: string;

  beforeEach(async () => {
    const res = await placeOrder(customerToken);
    orderId = res.body.order.id;
  });

  it('cannot confirm an already-confirmed order', async () => {
    await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('cannot mark ready before confirmed', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/ready`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('cannot accept a placed (not ready) order', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(409);
  });

  it('cannot pickup before accepting (driver does not own unaccepted order → 403)', async () => {
    await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app)
      .post(`/orders/${orderId}/pickup`)
      .set('Authorization', `Bearer ${driverToken}`);
    // driver_id is null (not assigned), so ownership check fires before state check → 403
    expect(res.status).toBe(403);
  });

  it('cannot deliver before pickup', async () => {
    await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/accept`).set('Authorization', `Bearer ${driverToken}`);
    const res = await request(app)
      .post(`/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(409);
  });
});

// ─── 5. Cancellation ─────────────────────────────────────────────────────────

describe('Order cancellation', () => {
  it('customer can cancel a placed order', async () => {
    const placeRes = await placeOrder(customerToken);
    const oid = placeRes.body.order.id;

    const res = await request(app)
      .post(`/orders/${oid}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Changed my mind' });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
    expect(res.body.order.cancel_reason).toBe('Changed my mind');
  });

  it('customer cannot cancel an already-confirmed order', async () => {
    const placeRes = await placeOrder(customerToken);
    const oid = placeRes.body.order.id;
    await request(app).post(`/orders/${oid}/confirm`).set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app)
      .post(`/orders/${oid}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/confirmed/i);
  });

  it('customer cannot cancel another customer\'s order', async () => {
    const placeRes = await placeOrder(customerToken);
    const oid = placeRes.body.order.id;

    const res = await request(app)
      .post(`/orders/${oid}/cancel`)
      .set('Authorization', `Bearer ${customerToken2}`);
    expect(res.status).toBe(403);
  });
});

// ─── 6. Race Condition: Concurrent Accept ─────────────────────────────────────

describe('Race condition: concurrent accept', () => {
  it('only one driver can accept the same order', async () => {
    // Register a second driver
    const driverRes2 = await request(app).post('/auth/v2/register/driver').send({
      full_name: 'Driver Two',
      email: 'driver2@orders.test',
      password: 'Password123!',
      date_of_birth: '2006-06-15',
      state: 'TX',
      city: 'Austin',
      parent_email: 'parent2@orders.test',
    });
    const tok2 = driverRes2.body._dev?.emailVerifyToken;
    if (tok2) await request(app).post(`/auth/v2/verify-email/${tok2}`);
    await db.query(
      `UPDATE driver_profiles SET consent_approved = TRUE WHERE user_id = (
        SELECT id FROM users WHERE email_lower = 'driver2@orders.test'
      )`
    );
    const driverToken2 = await loginAs('driver2@orders.test', 'Password123!');

    // Place and advance order to ready_for_pickup
    const placeRes = await placeOrder(customerToken);
    const oid = placeRes.body.order.id;
    await request(app).post(`/orders/${oid}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${oid}/ready`).set('Authorization', `Bearer ${adminToken}`);

    // Both drivers try to accept simultaneously
    const [res1, res2] = await Promise.all([
      request(app).post(`/orders/${oid}/accept`).set('Authorization', `Bearer ${driverToken}`),
      request(app).post(`/orders/${oid}/accept`).set('Authorization', `Bearer ${driverToken2}`),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
  });
});

// ─── 7. Role-based Access Control ────────────────────────────────────────────

describe('Role-based access control', () => {
  let orderId: string;

  beforeAll(async () => {
    const res = await placeOrder(customerToken);
    orderId = res.body.order.id;
  });

  it('driver cannot confirm an order', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  it('customer cannot accept an order', async () => {
    const res = await request(app)
      .post(`/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('driver cannot view another driver\'s assigned order directly', async () => {
    // Advance to assigned
    await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/accept`).set('Authorization', `Bearer ${driverToken}`);

    const driverToken2 = await loginAs('driver2@orders.test', 'Password123!');
    const res = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${driverToken2}`);
    expect(res.status).toBe(403);
  });

  it('GET /orders/restaurant/:rid requires admin', async () => {
    const res = await request(app)
      .get(`/orders/restaurant/${restaurantId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /orders/available requires driver', async () => {
    const res = await request(app)
      .get('/orders/available')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request to any route returns 401', async () => {
    const res = await request(app).get('/orders/available');
    expect(res.status).toBe(401);
  });
});

// ─── 8. Admin: List Restaurant Orders ────────────────────────────────────────

describe('GET /orders/restaurant/:rid — admin', () => {
  it('admin can list all orders for a restaurant', async () => {
    const res = await request(app)
      .get(`/orders/restaurant/${restaurantId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
  });

  it('can filter by status', async () => {
    const res = await request(app)
      .get(`/orders/restaurant/${restaurantId}?status=placed`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.orders.every((o: any) => o.status === 'placed')).toBe(true);
  });
});

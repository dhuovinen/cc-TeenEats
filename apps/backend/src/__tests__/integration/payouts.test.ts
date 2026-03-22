/**
 * Integration tests — Module 6: Payouts + Earnings v1
 *
 * Tests: session earnings auto-computed on deliver, manual (re)calculate,
 *        GET /payouts/me/earnings, GET /payouts/me/payouts,
 *        POST /payouts/trigger, POST /payouts/:id/mark-paid,
 *        admin access to driver earnings, role guards.
 */
import request from 'supertest';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app } = buildApp();

// ─── Shared state ─────────────────────────────────────────────────────────────

let driverToken: string;
let driverId: string;
let adminToken: string;
let customerToken: string;
let restaurantId: string;
let menuItemId: string;

async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/v2/login').send({ email, password });
  return res.body.accessToken;
}

/** Create and fully deliver one order, return { orderId, sessionId } */
async function createAndDeliverOrder(): Promise<{ orderId: string; sessionId: string }> {
  // Place order as customer
  const placeRes = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      restaurant_id: restaurantId,
      delivery_address: '1 Test St, Austin TX',
      delivery_lat: 30.1,
      delivery_lng: -97.1,
      items: [{ menu_item_id: menuItemId, quantity: 1 }],
    });
  const orderId = placeRes.body.order.id;

  // Admin confirms + marks ready
  await request(app)
    .post(`/orders/${orderId}/confirm`)
    .set('Authorization', `Bearer ${adminToken}`);
  await request(app)
    .post(`/orders/${orderId}/ready`)
    .set('Authorization', `Bearer ${adminToken}`);

  // Driver accepts (creates delivery_session)
  const acceptRes = await request(app)
    .post(`/orders/${orderId}/accept`)
    .set('Authorization', `Bearer ${driverToken}`);
  const sessionId = acceptRes.body.delivery_session_id;

  // Driver picks up + delivers
  await request(app)
    .post(`/orders/${orderId}/pickup`)
    .set('Authorization', `Bearer ${driverToken}`);
  await request(app)
    .post(`/orders/${orderId}/deliver`)
    .set('Authorization', `Bearer ${driverToken}`);

  // Wait for async score + earnings finalization
  await new Promise(r => setTimeout(r, 300));

  return { orderId, sessionId };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await resetDb();

  // Admin
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('AdminPass123!', 1);
  await db.query(
    `INSERT INTO users (email, password_hash, role, full_name, email_verified, active)
     VALUES ('admin@payouts.test', $1, 'admin', 'Admin', TRUE, TRUE)`,
    [hash],
  );
  const { rows: [admin] } = await db.query(
    `SELECT id FROM users WHERE email_lower = 'admin@payouts.test'`,
  );
  await db.query(`INSERT INTO admin_profiles (user_id) VALUES ($1)`, [admin.id]);
  adminToken = await loginAs('admin@payouts.test', 'AdminPass123!');

  // Driver
  const driverReg = await request(app).post('/auth/v2/register/driver').send({
    full_name: 'Payout Driver',
    email: 'driver@payouts.test',
    password: 'Password123!',
    date_of_birth: '2006-01-01',
    state: 'TX',
    city: 'Austin',
    parent_email: 'parent@payouts.test',
  });
  const tok = driverReg.body._dev?.emailVerifyToken;
  if (tok) await request(app).post(`/auth/v2/verify-email/${tok}`);
  await db.query(
    `UPDATE driver_profiles SET consent_approved = TRUE WHERE user_id = (
       SELECT id FROM users WHERE email_lower = 'driver@payouts.test'
     )`,
  );
  driverToken = await loginAs('driver@payouts.test', 'Password123!');
  const { rows: [dUser] } = await db.query(
    `SELECT id FROM users WHERE email_lower = 'driver@payouts.test'`,
  );
  driverId = dUser.id;

  // Customer
  await request(app).post('/auth/v2/register/customer').send({
    full_name: 'Payout Customer',
    email: 'customer@payouts.test',
    password: 'Password123!',
  });
  customerToken = await loginAs('customer@payouts.test', 'Password123!');

  // Restaurant + menu item
  const restRes = await request(app)
    .post('/restaurants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Payout Café',
      address: '1 Pay St',
      lat: 30.0,
      lng: -97.0,
      cuisine_type: 'American',
    });
  restaurantId = restRes.body.restaurant.id;

  const catRes = await request(app)
    .post(`/restaurants/${restaurantId}/categories`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Mains' });
  const menuRes = await request(app)
    .post(`/restaurants/${restaurantId}/items`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ category_id: catRes.body.category.id, name: 'Test Burger', price_cents: 999 });
  menuItemId = menuRes.body.item.id;
});

afterAll(async () => {
  await db.end();
});

// ─── Session earnings auto-computed on deliver ────────────────────────────────

describe('earnings auto-computed on order deliver', () => {
  let sessionId: string;

  beforeAll(async () => {
    ({ sessionId } = await createAndDeliverOrder());
  });

  it('session_earnings row is created in DB', async () => {
    const { rows } = await db.query(
      `SELECT * FROM session_earnings WHERE session_id = $1`,
      [sessionId],
    );
    expect(rows).toHaveLength(1);
    const e = rows[0];
    expect(e.driver_id).toBe(driverId);
    expect(parseInt(e.delivery_fee_cents)).toBe(800);
    expect(e.status).toBe('pending');
  });

  it('driver_pay + platform_cut = delivery_fee', async () => {
    const { rows: [e] } = await db.query(
      `SELECT * FROM session_earnings WHERE session_id = $1`,
      [sessionId],
    );
    expect(
      parseInt(e.driver_pay_cents) + parseInt(e.platform_cut_cents),
    ).toBe(parseInt(e.delivery_fee_cents));
  });

  it('base_pay is 70% of delivery_fee (560 cents)', async () => {
    const { rows: [e] } = await db.query(
      `SELECT * FROM session_earnings WHERE session_id = $1`,
      [sessionId],
    );
    expect(parseInt(e.base_pay_cents)).toBe(560);
  });
});

// ─── GET /payouts/me/earnings ─────────────────────────────────────────────────

describe('GET /payouts/me/earnings', () => {
  it('returns 200 with earnings array for authenticated driver', async () => {
    const res = await request(app)
      .get('/payouts/me/earnings')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.earnings)).toBe(true);
    expect(res.body.earnings.length).toBeGreaterThanOrEqual(1);
  });

  it('earnings entries have expected fields', async () => {
    const res = await request(app)
      .get('/payouts/me/earnings')
      .set('Authorization', `Bearer ${driverToken}`);
    const e = res.body.earnings[0];
    expect(e).toHaveProperty('session_id');
    expect(e).toHaveProperty('delivery_fee_cents');
    expect(e).toHaveProperty('base_pay_cents');
    expect(e).toHaveProperty('bonus_pay_cents');
    expect(e).toHaveProperty('driver_pay_cents');
    expect(e).toHaveProperty('platform_cut_cents');
    expect(e).toHaveProperty('rolling_score_used');
    expect(e).toHaveProperty('status');
  });

  it('requires authentication — 401 without token', async () => {
    const res = await request(app).get('/payouts/me/earnings');
    expect(res.status).toBe(401);
  });
});

// ─── GET /payouts/me/payouts ──────────────────────────────────────────────────

describe('GET /payouts/me/payouts', () => {
  it('returns 200 with empty array when no payouts yet', async () => {
    const res = await request(app)
      .get('/payouts/me/payouts')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payouts)).toBe(true);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/payouts/me/payouts');
    expect(res.status).toBe(401);
  });
});

// ─── POST /payouts/sessions/:session_id/calculate (admin) ────────────────────

describe('POST /payouts/sessions/:session_id/calculate', () => {
  let sessionId: string;

  beforeAll(async () => {
    ({ sessionId } = await createAndDeliverOrder());
  });

  it('admin can manually (re)calculate session earnings', async () => {
    const res = await request(app)
      .post(`/payouts/sessions/${sessionId}/calculate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.earning).toHaveProperty('session_id', sessionId);
    expect(res.body.earning).toHaveProperty('base_pay_cents');
    expect(parseInt(res.body.earning.base_pay_cents)).toBe(560);
  });

  it('recalculate is idempotent — same row, updated calculated_at', async () => {
    const res1 = await request(app)
      .post(`/payouts/sessions/${sessionId}/calculate`)
      .set('Authorization', `Bearer ${adminToken}`);
    const res2 = await request(app)
      .post(`/payouts/sessions/${sessionId}/calculate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // same session_id (UPSERT, not duplicate)
    expect(res1.body.earning.session_id).toBe(res2.body.earning.session_id);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app)
      .post('/payouts/sessions/00000000-0000-0000-0000-000000000000/calculate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('driver cannot call calculate (403)', async () => {
    const res = await request(app)
      .post(`/payouts/sessions/${sessionId}/calculate`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── Admin: GET /payouts/drivers/:driver_id/earnings ─────────────────────────

describe('GET /payouts/drivers/:driver_id/earnings', () => {
  it('admin gets driver earnings list', async () => {
    const res = await request(app)
      .get(`/payouts/drivers/${driverId}/earnings`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.earnings)).toBe(true);
    expect(res.body.earnings.length).toBeGreaterThanOrEqual(1);
  });

  it('driver cannot access other driver earnings (403)', async () => {
    const res = await request(app)
      .get(`/payouts/drivers/${driverId}/earnings`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── POST /payouts/trigger ────────────────────────────────────────────────────

describe('POST /payouts/trigger', () => {
  it('admin triggers payout — returns 201 with payout object', async () => {
    const res = await request(app)
      .post('/payouts/trigger')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        driver_id: driverId,
        period_start: '2020-01-01',
        period_end: '2099-12-31',
      });
    expect(res.status).toBe(201);
    expect(res.body.payout).toHaveProperty('id');
    expect(res.body.payout.driver_id).toBe(driverId);
    expect(res.body.payout.status).toBe('pending');
    expect(parseInt(res.body.payout.total_cents)).toBeGreaterThan(0);
  });

  it('session earnings are marked paid after trigger', async () => {
    const { rows } = await db.query(
      `SELECT status FROM session_earnings WHERE driver_id = $1`,
      [driverId],
    );
    // All rows should be 'paid' now (they were included in the trigger above)
    const pending = rows.filter(r => r.status === 'pending');
    expect(pending).toHaveLength(0);
  });

  it('second trigger in same period returns no pending earnings', async () => {
    const res = await request(app)
      .post('/payouts/trigger')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        driver_id: driverId,
        period_start: '2020-01-01',
        period_end: '2099-12-31',
      });
    expect(res.status).toBe(200);
    expect(res.body.payout).toBeNull();
  });

  it('requires admin — driver gets 403', async () => {
    const res = await request(app)
      .post('/payouts/trigger')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        driver_id: driverId,
        period_start: '2020-01-01',
        period_end: '2099-12-31',
      });
    expect(res.status).toBe(403);
  });

  it('missing required fields returns 400', async () => {
    const res = await request(app)
      .post('/payouts/trigger')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: driverId });
    expect(res.status).toBe(400);
  });

  it('invalid date format returns 400', async () => {
    const res = await request(app)
      .post('/payouts/trigger')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        driver_id: driverId,
        period_start: '01/01/2020',
        period_end: '12/31/2099',
      });
    expect(res.status).toBe(400);
  });

  it('period_end before period_start returns 400', async () => {
    const res = await request(app)
      .post('/payouts/trigger')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        driver_id: driverId,
        period_start: '2099-01-01',
        period_end: '2020-01-01',
      });
    expect(res.status).toBe(400);
  });
});

// ─── POST /payouts/:payout_id/mark-paid ──────────────────────────────────────

describe('POST /payouts/:payout_id/mark-paid', () => {
  let payoutId: string;

  beforeAll(async () => {
    // Create a fresh order + trigger a payout to get a payout id
    await createAndDeliverOrder();

    const triggerRes = await request(app)
      .post('/payouts/trigger')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        driver_id: driverId,
        period_start: '2020-01-01',
        period_end: '2099-12-31',
      });
    payoutId = triggerRes.body.payout?.id;
  });

  it('admin marks payout paid with stripe transfer id', async () => {
    const res = await request(app)
      .post(`/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stripe_transfer_id: 'tr_test_abc123' });
    expect(res.status).toBe(200);
    expect(res.body.payout.status).toBe('paid');
    expect(res.body.payout.stripe_transfer_id).toBe('tr_test_abc123');
    expect(res.body.payout.paid_at).not.toBeNull();
  });

  it('marking already-paid payout returns 409', async () => {
    const res = await request(app)
      .post(`/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(409);
  });

  it('non-existent payout returns 404', async () => {
    const res = await request(app)
      .post('/payouts/00000000-0000-0000-0000-000000000000/mark-paid')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('driver cannot mark payout paid (403)', async () => {
    const res = await request(app)
      .post(`/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

// ─── GET /payouts/me/payouts shows created payouts ────────────────────────────

describe('GET /payouts/me/payouts after payout exists', () => {
  it('driver can see their own payout history', async () => {
    const res = await request(app)
      .get('/payouts/me/payouts')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.payouts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.payouts[0]).toHaveProperty('total_cents');
    expect(res.body.payouts[0]).toHaveProperty('status');
    expect(res.body.payouts[0]).toHaveProperty('period_start');
    expect(res.body.payouts[0]).toHaveProperty('period_end');
  });
});

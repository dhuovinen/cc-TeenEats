/**
 * Integration tests — Module 4: Compliance Engine
 *
 * Tests DB-backed compliance: work hour tracking, enforcement on order accept,
 * compliance status endpoint, admin routes (rules, violations, record).
 */
import request from 'supertest';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app } = buildApp();

// ─── Shared state ─────────────────────────────────────────────────────────────

let driverTokenTX: string;
let driverTokenCA: string;
let driverTokenNY: string;
let adminToken: string;
let driverIdTX: string;
let driverIdCA: string;
let restaurantId: string;
let menuItemId: string;

async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/v2/login').send({ email, password });
  return res.body.accessToken;
}

async function createAndLoginDriver(opts: {
  name: string; email: string; state: string;
}): Promise<{ token: string; userId: string }> {
  const regRes = await request(app).post('/auth/v2/register/driver').send({
    full_name: opts.name,
    email: opts.email,
    password: 'Password123!',
    date_of_birth: '2006-01-01',
    state: opts.state,
    city: 'Test City',
    parent_email: `parent+${opts.state.toLowerCase()}@compliance.test`,
  });
  const tok = regRes.body._dev?.emailVerifyToken;
  if (tok) await request(app).post(`/auth/v2/verify-email/${tok}`);
  await db.query(
    `UPDATE driver_profiles SET consent_approved = TRUE WHERE user_id = (
      SELECT id FROM users WHERE email_lower = $1
    )`,
    [opts.email.toLowerCase()]
  );
  const token = await loginAs(opts.email, 'Password123!');
  const { rows: [user] } = await db.query(
    `SELECT id FROM users WHERE email_lower = $1`,
    [opts.email.toLowerCase()]
  );
  return { token, userId: user.id };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await resetDb();

  // Admin
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('AdminPass123!', 1);
  await db.query(
    `INSERT INTO users (email, password_hash, role, full_name, email_verified, active)
     VALUES ('admin@compliance.test', $1, 'admin', 'Admin', TRUE, TRUE)`,
    [hash]
  );
  const { rows: [adminUser] } = await db.query(
    `SELECT id FROM users WHERE email_lower = 'admin@compliance.test'`
  );
  await db.query(`INSERT INTO admin_profiles (user_id) VALUES ($1)`, [adminUser.id]);
  adminToken = await loginAs('admin@compliance.test', 'AdminPass123!');

  // Drivers in different states
  const tx = await createAndLoginDriver({ name: 'TX Driver', email: 'driver.tx@compliance.test', state: 'TX' });
  driverTokenTX = tx.token;
  driverIdTX = tx.userId;

  const ca = await createAndLoginDriver({ name: 'CA Driver', email: 'driver.ca@compliance.test', state: 'CA' });
  driverTokenCA = ca.token;
  driverIdCA = ca.userId;

  const ny = await createAndLoginDriver({ name: 'NY Driver', email: 'driver.ny@compliance.test', state: 'NY' });
  driverTokenNY = ny.token;

  // Create a restaurant + menu item for order tests
  const restRes = await request(app)
    .post('/restaurants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Compliance Test Café', address: '1 Test St', lat: 30.0, lng: -97.0, cuisine_type: 'American' });
  restaurantId = restRes.body.restaurant.id;

  const catRes = await request(app)
    .post(`/restaurants/${restaurantId}/categories`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Mains' });

  const itemRes = await request(app)
    .post(`/restaurants/${restaurantId}/items`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ category_id: catRes.body.category.id, name: 'Burger', price_cents: 900 });
  menuItemId = itemRes.body.item.id;
}, 60000);

afterAll(async () => { await db.end(); });

// ─── Helper: advance order to ready_for_pickup ────────────────────────────────

async function createReadyOrder(customerToken: string): Promise<string> {
  const placeRes = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      restaurant_id: restaurantId,
      delivery_address: '2 Delivery Ave',
      items: [{ menu_item_id: menuItemId, quantity: 1 }],
    });
  const orderId = placeRes.body.order.id;
  await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
  await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);
  return orderId;
}

// ─── Register customer for order tests ────────────────────────────────────────

let customerToken: string;

beforeAll(async () => {
  await request(app).post('/auth/v2/register/customer').send({
    full_name: 'Test Customer',
    email: 'customer@compliance.test',
    password: 'Password123!',
  });
  customerToken = await loginAs('customer@compliance.test', 'Password123!');
}, 30000);

// ─── 1. Compliance Status Endpoint ───────────────────────────────────────────

describe('GET /compliance/status', () => {
  it('TX driver with no work hours is allowed (no caps)', async () => {
    const res = await request(app)
      .get('/compliance/status')
      .set('Authorization', `Bearer ${driverTokenTX}`);
    expect(res.status).toBe(200);
    expect(res.body.compliance.allowed).toBe(true);
    expect(res.body.compliance.daily_minutes_used).toBe(0);
    expect(res.body.compliance.weekly_minutes_used).toBe(0);
    expect(res.body.compliance.daily_minutes_limit).toBeNull();
    expect(res.body.compliance.weekly_minutes_limit).toBeNull();
  });

  it('CA driver with no work hours is allowed', async () => {
    const res = await request(app)
      .get('/compliance/status')
      .set('Authorization', `Bearer ${driverTokenCA}`);
    expect(res.status).toBe(200);
    expect(res.body.compliance.allowed).toBe(true);
  });

  it('requires driver role (customer → 403)', async () => {
    const res = await request(app)
      .get('/compliance/status')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('requires auth (unauthenticated → 401)', async () => {
    const res = await request(app).get('/compliance/status');
    expect(res.status).toBe(401);
  });
});

// ─── 2. Admin: record work time ───────────────────────────────────────────────

describe('POST /compliance/record', () => {
  it('admin can record work minutes for a driver', async () => {
    const res = await request(app)
      .post('/compliance/record')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: driverIdTX, minutes: 90 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('work minutes show up in driver compliance status', async () => {
    // Record some time for CA driver
    await request(app)
      .post('/compliance/record')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: driverIdCA, minutes: 120 });

    const res = await request(app)
      .get('/compliance/status')
      .set('Authorization', `Bearer ${driverTokenCA}`);
    expect(res.status).toBe(200);
    expect(res.body.compliance.daily_minutes_used).toBeGreaterThanOrEqual(120);
    expect(res.body.compliance.weekly_minutes_used).toBeGreaterThanOrEqual(120);
  });

  it('rejects missing driver_id', async () => {
    const res = await request(app)
      .post('/compliance/record')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ minutes: 60 });
    expect(res.status).toBe(400);
  });

  it('rejects non-positive minutes', async () => {
    const res = await request(app)
      .post('/compliance/record')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: driverIdTX, minutes: 0 });
    expect(res.status).toBe(400);
  });

  it('requires admin role', async () => {
    const res = await request(app)
      .post('/compliance/record')
      .set('Authorization', `Bearer ${driverTokenTX}`)
      .send({ driver_id: driverIdTX, minutes: 60 });
    expect(res.status).toBe(403);
  });
});

// ─── 3. Compliance enforcement on order accept ────────────────────────────────

describe('Compliance enforcement: order accept blocked when at cap', () => {
  it('TX driver can always accept (no caps) regardless of hours worked', async () => {
    // TX has no limits, should always be allowed
    // Record 10 hours (600 min) — well over any reasonable cap
    await request(app)
      .post('/compliance/record')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: driverIdTX, minutes: 600 });

    const orderId = await createReadyOrder(customerToken);
    const res = await request(app)
      .post(`/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${driverTokenTX}`);
    expect(res.status).toBe(200);
  });

  it('NY driver blocked when at 28hr (1680 min) school week cap', async () => {
    const { rows: [nyUser] } = await db.query(
      `SELECT id FROM users WHERE email_lower = 'driver.ny@compliance.test'`
    );
    const nyDriverId = nyUser.id;

    // Find out how much they've worked this week
    const statusRes = await request(app)
      .get('/compliance/status')
      .set('Authorization', `Bearer ${driverTokenNY}`);
    const weeklyUsed = statusRes.body.compliance.weekly_minutes_used || 0;

    // Determine if we're in school year to know which cap applies
    const now = new Date();
    const month = now.getUTCMonth(); // 0-indexed
    const isSchoolYear = !(month >= 5 && month <= 8); // June(5) - Sept(8) = summer

    if (!isSchoolYear) {
      // Summer — weekly cap is 2880 (48hrs). Skip the specific cap test but verify status OK.
      const res = await request(app)
        .get('/compliance/status')
        .set('Authorization', `Bearer ${driverTokenNY}`);
      expect(res.status).toBe(200);
      return;
    }

    // School year: record enough to hit 1680 (28hr) cap
    const toAdd = Math.max(1680 - weeklyUsed, 1);
    await request(app)
      .post('/compliance/record')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: nyDriverId, minutes: toAdd });

    const orderId = await createReadyOrder(customerToken);
    const res = await request(app)
      .post(`/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${driverTokenNY}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/compliance block/i);
    expect(res.body.compliance.allowed).toBe(false);
    expect(res.body.compliance.violation_type).toBeTruthy(); // daily_cap fires before weekly_cap when all recorded today
  });
});

// ─── 4. Admin: compliance rules ───────────────────────────────────────────────

describe('GET /compliance/rules', () => {
  it('admin can list all state rules', async () => {
    const res = await request(app)
      .get('/compliance/rules')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rules)).toBe(true);
    expect(res.body.rules.length).toBeGreaterThanOrEqual(5); // TX, CA, NY, FL, IL, WA
    const states = res.body.rules.map((r: any) => r.state);
    expect(states).toContain('TX');
    expect(states).toContain('CA');
    expect(states).toContain('NY');
  });

  it('admin can get a single state rule', async () => {
    const res = await request(app)
      .get('/compliance/rules/CA')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rule.state).toBe('CA');
    expect(res.body.rule.daily_school_day_minutes).toBe(240);
    expect(res.body.rule.school_night_end_time).toBeTruthy();
  });

  it('returns 404 for unknown state', async () => {
    const res = await request(app)
      .get('/compliance/rules/ZZ')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('requires admin role', async () => {
    const res = await request(app)
      .get('/compliance/rules')
      .set('Authorization', `Bearer ${driverTokenTX}`);
    expect(res.status).toBe(403);
  });

  it('TX rule has null caps (no restrictions)', async () => {
    const res = await request(app)
      .get('/compliance/rules/TX')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rule.daily_school_day_minutes).toBeNull();
    expect(res.body.rule.weekly_school_week_minutes).toBeNull();
    expect(res.body.rule.school_night_end_time).toBeNull();
  });
});

// ─── 5. Admin: violations log ─────────────────────────────────────────────────

describe('GET /compliance/violations', () => {
  it('admin can list violations', async () => {
    const res = await request(app)
      .get('/compliance/violations')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.violations)).toBe(true);
  });

  it('requires admin role', async () => {
    const res = await request(app)
      .get('/compliance/violations')
      .set('Authorization', `Bearer ${driverTokenTX}`);
    expect(res.status).toBe(403);
  });
});

// ─── 6. Multiple work time recordings accumulate ──────────────────────────────

describe('Work time accumulates across multiple records', () => {
  it('recording twice adds up correctly', async () => {
    // Fresh driver for isolation
    const res1 = await request(app).post('/auth/v2/register/driver').send({
      full_name: 'Accum Driver',
      email: 'accum@compliance.test',
      password: 'Password123!',
      date_of_birth: '2006-03-15',
      state: 'CA',
      city: 'LA',
      parent_email: 'accumparent@compliance.test',
    });
    const tok = res1.body._dev?.emailVerifyToken;
    if (tok) await request(app).post(`/auth/v2/verify-email/${tok}`);
    const { rows: [u] } = await db.query(
      `SELECT id FROM users WHERE email_lower = 'accum@compliance.test'`
    );
    await db.query(
      `UPDATE driver_profiles SET consent_approved = TRUE WHERE user_id = $1`,
      [u.id]
    );
    const accumToken = await loginAs('accum@compliance.test', 'Password123!');

    // Record 100 + 50 = 150 minutes
    await request(app).post('/compliance/record').set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: u.id, minutes: 100 });
    await request(app).post('/compliance/record').set('Authorization', `Bearer ${adminToken}`)
      .send({ driver_id: u.id, minutes: 50 });

    const statusRes = await request(app)
      .get('/compliance/status')
      .set('Authorization', `Bearer ${accumToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.compliance.daily_minutes_used).toBe(150);
    expect(statusRes.body.compliance.weekly_minutes_used).toBe(150);
  });
});

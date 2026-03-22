/**
 * Integration tests — Module 5: Safety Scoring v1
 *
 * Tests: event submission, session finalization, rolling score,
 *        GET /scoring/me, GET /scoring/drivers/:id, access control.
 */
import request from 'supertest';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app } = buildApp();

// ─── Shared state ─────────────────────────────────────────────────────────────

let driverToken: string;
let driverId: string;
let adminToken: string;
let restaurantId: string;
let menuItemId: string;
let customerToken: string;

async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/v2/login').send({ email, password });
  return res.body.accessToken;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await resetDb();

  // Admin
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('AdminPass123!', 1);
  await db.query(
    `INSERT INTO users (email, password_hash, role, full_name, email_verified, active)
     VALUES ('admin@scoring.test', $1, 'admin', 'Admin', TRUE, TRUE)`,
    [hash]
  );
  const { rows: [admin] } = await db.query(
    `SELECT id FROM users WHERE email_lower = 'admin@scoring.test'`
  );
  await db.query(`INSERT INTO admin_profiles (user_id) VALUES ($1)`, [admin.id]);
  adminToken = await loginAs('admin@scoring.test', 'AdminPass123!');

  // Driver
  const driverReg = await request(app).post('/auth/v2/register/driver').send({
    full_name: 'Score Driver',
    email: 'driver@scoring.test',
    password: 'Password123!',
    date_of_birth: '2006-01-01',
    state: 'TX',
    city: 'Austin',
    parent_email: 'parent@scoring.test',
  });
  const tok = driverReg.body._dev?.emailVerifyToken;
  if (tok) await request(app).post(`/auth/v2/verify-email/${tok}`);
  await db.query(
    `UPDATE driver_profiles SET consent_approved = TRUE WHERE user_id = (
       SELECT id FROM users WHERE email_lower = 'driver@scoring.test'
     )`
  );
  driverToken = await loginAs('driver@scoring.test', 'Password123!');
  const { rows: [dUser] } = await db.query(
    `SELECT id FROM users WHERE email_lower = 'driver@scoring.test'`
  );
  driverId = dUser.id;

  // Customer
  await request(app).post('/auth/v2/register/customer').send({
    full_name: 'Score Customer',
    email: 'customer@scoring.test',
    password: 'Password123!',
  });
  customerToken = await loginAs('customer@scoring.test', 'Password123!');

  // Restaurant + menu item
  const restRes = await request(app)
    .post('/restaurants').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Score Café', address: '1 Score St', lat: 30.0, lng: -97.0, cuisine_type: 'American' });
  restaurantId = restRes.body.restaurant.id;

  const catRes = await request(app)
    .post(`/restaurants/${restaurantId}/categories`).set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Mains' });
  const itemRes = await request(app)
    .post(`/restaurants/${restaurantId}/items`).set('Authorization', `Bearer ${adminToken}`)
    .send({ category_id: catRes.body.category.id, name: 'Burger', price_cents: 900 });
  menuItemId = itemRes.body.item.id;
}, 60000);

afterAll(async () => { await db.end(); });

// ─── Helper: full order lifecycle → returns delivery_session_id ───────────────

async function runFullOrderCycle(): Promise<string> {
  const placeRes = await request(app)
    .post('/orders').set('Authorization', `Bearer ${customerToken}`)
    .send({
      restaurant_id: restaurantId,
      delivery_address: '99 Deliver Ave',
      items: [{ menu_item_id: menuItemId, quantity: 1 }],
    });
  const orderId = placeRes.body.order.id;

  await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
  await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);

  const acceptRes = await request(app)
    .post(`/orders/${orderId}/accept`).set('Authorization', `Bearer ${driverToken}`);
  const deliverySessionId = acceptRes.body.delivery_session_id;

  await request(app).post(`/orders/${orderId}/pickup`).set('Authorization', `Bearer ${driverToken}`);
  await request(app).post(`/orders/${orderId}/deliver`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ distance_km: 2.5, duration_minutes: 10 });

  return deliverySessionId;
}

// ─── 1. Order accept returns delivery_session_id ──────────────────────────────

describe('Order accept includes delivery_session_id', () => {
  it('POST /orders/:id/accept returns delivery_session_id', async () => {
    const placeRes = await request(app)
      .post('/orders').set('Authorization', `Bearer ${customerToken}`)
      .send({
        restaurant_id: restaurantId,
        delivery_address: '1 Test Rd',
        items: [{ menu_item_id: menuItemId, quantity: 1 }],
      });
    const orderId = placeRes.body.order.id;

    await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);

    const acceptRes = await request(app)
      .post(`/orders/${orderId}/accept`).set('Authorization', `Bearer ${driverToken}`);

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.delivery_session_id).toBeTruthy();
    expect(typeof acceptRes.body.delivery_session_id).toBe('string');

    // Clean up — deliver the order
    await request(app).post(`/orders/${orderId}/pickup`).set('Authorization', `Bearer ${driverToken}`);
    await request(app).post(`/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${driverToken}`).send({ duration_minutes: 8 });
  });
});

// ─── 2. Submitting driving events ─────────────────────────────────────────────

describe('POST /scoring/events — submit driving events', () => {
  let sessionId: string;

  beforeAll(async () => {
    // Get a live session (place + accept, don't deliver yet)
    const placeRes = await request(app)
      .post('/orders').set('Authorization', `Bearer ${customerToken}`)
      .send({
        restaurant_id: restaurantId,
        delivery_address: '2 Events Blvd',
        items: [{ menu_item_id: menuItemId, quantity: 1 }],
      });
    const orderId = placeRes.body.order.id;
    await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);
    const acceptRes = await request(app)
      .post(`/orders/${orderId}/accept`).set('Authorization', `Bearer ${driverToken}`);
    sessionId = acceptRes.body.delivery_session_id;

    // Deliver it after so the session is completed for later tests
    await request(app).post(`/orders/${orderId}/pickup`).set('Authorization', `Bearer ${driverToken}`);
    await request(app).post(`/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${driverToken}`).send({ duration_minutes: 12 });
  });

  it('driver can submit speed violation events', async () => {
    // Use the session before delivery was completed (events are stored retroactively ok)
    const res = await request(app)
      .post('/scoring/events')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        session_id: sessionId,
        events: [
          { speed_kph: 64.4, speed_limit_kph: 48.3, lat: 30.0, lng: -97.0 }, // ~10 mph over
          { speed_kph: 80.5, speed_limit_kph: 48.3, lat: 30.1, lng: -97.1 }, // ~20 mph over
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.events_recorded).toBe(2);
    expect(res.body.penalties_triggered).toBeGreaterThan(0);
  });

  it('driver can submit harsh braking events', async () => {
    const res = await request(app)
      .post('/scoring/events')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        session_id: sessionId,
        events: [
          { event_type: 'harsh_braking', g_force: 0.52, lat: 30.0, lng: -97.0 },
          { event_type: 'rapid_acceleration', g_force: 0.45, lat: 30.1, lng: -97.1 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.events_recorded).toBe(2);
    expect(res.body.penalties_triggered).toBe(2);
  });

  it('sub-threshold braking events trigger no penalty', async () => {
    const res = await request(app)
      .post('/scoring/events')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        session_id: sessionId,
        events: [{ event_type: 'harsh_braking', g_force: 0.30, lat: 30.0, lng: -97.0 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.penalties_triggered).toBe(0);
  });

  it('requires session_id and events[]', async () => {
    const res = await request(app)
      .post('/scoring/events')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ events: [] });
    expect(res.status).toBe(400);
  });

  it('requires driver role', async () => {
    const res = await request(app)
      .post('/scoring/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ session_id: sessionId, events: [{ event_type: 'harsh_braking', g_force: 0.5 }] });
    expect(res.status).toBe(403);
  });
});

// ─── 3. Session score finalization ────────────────────────────────────────────

describe('Session score finalization', () => {
  it('POST /orders/:id/deliver triggers score calculation (session_scores row created)', async () => {
    const sessionId = await runFullOrderCycle();
    // Give the async finalization a moment to complete
    await new Promise(r => setTimeout(r, 200));

    const { rows } = await db.query(
      'SELECT * FROM session_scores WHERE session_id = $1',
      [sessionId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].final_score).toBeGreaterThanOrEqual(0);
    expect(rows[0].final_score).toBeLessThanOrEqual(100);
  });

  it('admin can manually calculate session score', async () => {
    const sessionId = await runFullOrderCycle();
    await new Promise(r => setTimeout(r, 100));

    const res = await request(app)
      .post(`/scoring/sessions/${sessionId}/calculate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.score.final_score).toBeGreaterThanOrEqual(0);
  });

  it('session with speed violation events has reduced score', async () => {
    // Place order → accept → submit high-speed events → deliver → check score
    const placeRes = await request(app)
      .post('/orders').set('Authorization', `Bearer ${customerToken}`)
      .send({
        restaurant_id: restaurantId,
        delivery_address: '3 Speedy Ln',
        items: [{ menu_item_id: menuItemId, quantity: 1 }],
      });
    const orderId = placeRes.body.order.id;
    await request(app).post(`/orders/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).post(`/orders/${orderId}/ready`).set('Authorization', `Bearer ${adminToken}`);
    const acceptRes = await request(app)
      .post(`/orders/${orderId}/accept`).set('Authorization', `Bearer ${driverToken}`);
    const sessionId = acceptRes.body.delivery_session_id;

    // Submit 3 high-speed violations (3 × -20 = -60 raw → capped at -40)
    await request(app)
      .post('/scoring/events')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        session_id: sessionId,
        events: [
          { speed_kph: 130, speed_limit_kph: 80, lat: 30.0, lng: -97.0 }, // ~31 mph over → high
          { speed_kph: 130, speed_limit_kph: 80, lat: 30.1, lng: -97.0 }, // high
          { speed_kph: 130, speed_limit_kph: 80, lat: 30.2, lng: -97.0 }, // high
        ],
      });

    await request(app).post(`/orders/${orderId}/pickup`).set('Authorization', `Bearer ${driverToken}`);
    await request(app).post(`/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${driverToken}`).send({ duration_minutes: 8 });
    await new Promise(r => setTimeout(r, 300));

    // Manually calculate to avoid async timing issues
    await request(app)
      .post(`/scoring/sessions/${sessionId}/calculate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app)
      .get(`/scoring/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.score.final_score).toBe(60); // 100 - 40 (cap)
    expect(res.body.score.speed_violations).toBe(3);
    expect(res.body.score.speed_penalty).toBe(40); // capped
  });
});

// ─── 4. GET /scoring/sessions/:id ─────────────────────────────────────────────

describe('GET /scoring/sessions/:session_id', () => {
  let sessionId: string;

  beforeAll(async () => {
    sessionId = await runFullOrderCycle();
    await new Promise(r => setTimeout(r, 200));
    // Ensure score exists
    await request(app)
      .post(`/scoring/sessions/${sessionId}/calculate`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('driver can get own session score', async () => {
    const res = await request(app)
      .get(`/scoring/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.score.session_id).toBe(sessionId);
    expect(res.body.score.final_score).toBeDefined();
    expect(res.body.score.breakdown).toBeDefined();
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app)
      .get('/scoring/sessions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await request(app).get(`/scoring/sessions/${sessionId}`);
    expect(res.status).toBe(401);
  });
});

// ─── 5. GET /scoring/me (rolling score) ──────────────────────────────────────

describe('GET /scoring/me', () => {
  it('driver gets their rolling score after completing sessions', async () => {
    const res = await request(app)
      .get('/scoring/me')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recent_sessions)).toBe(true);
    // May have sessions_counted > 0 from earlier tests
  });

  it('requires driver role', async () => {
    const res = await request(app)
      .get('/scoring/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/scoring/me');
    expect(res.status).toBe(401);
  });
});

// ─── 6. GET /scoring/drivers/:driver_id (admin) ───────────────────────────────

describe('GET /scoring/drivers/:driver_id (admin)', () => {
  it('admin can get any driver rolling score', async () => {
    const res = await request(app)
      .get(`/scoring/drivers/${driverId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recent_sessions)).toBe(true);
  });

  it('driver cannot access admin driver scoring endpoint', async () => {
    const res = await request(app)
      .get(`/scoring/drivers/${driverId}`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── 7. Rolling score accuracy ────────────────────────────────────────────────

describe('Rolling score accuracy', () => {
  it('score_history is updated when session is finalized', async () => {
    const beforeCount = await db.query(
      'SELECT COUNT(*) FROM score_history WHERE driver_id = $1',
      [driverId]
    );

    await runFullOrderCycle();
    await new Promise(r => setTimeout(r, 300));

    const afterCount = await db.query(
      'SELECT COUNT(*) FROM score_history WHERE driver_id = $1',
      [driverId]
    );
    expect(parseInt(afterCount.rows[0].count)).toBeGreaterThan(
      parseInt(beforeCount.rows[0].count)
    );
  });

  it('latest score_history row has valid weighted_avg (0–100)', async () => {
    const { rows: [latest] } = await db.query(
      `SELECT weighted_avg FROM score_history WHERE driver_id = $1 ORDER BY computed_at DESC LIMIT 1`,
      [driverId]
    );
    expect(latest).toBeDefined();
    const avg = parseFloat(latest.weighted_avg);
    expect(avg).toBeGreaterThanOrEqual(0);
    expect(avg).toBeLessThanOrEqual(100);
  });
});

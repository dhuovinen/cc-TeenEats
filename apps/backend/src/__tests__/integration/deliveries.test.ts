import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../helpers/testApp';
import { resetDb, db, DRIVER_IDS } from '../helpers/testDb';

const { app, httpServer } = buildApp();

const DISPATCHER_KEY = process.env.DISPATCHER_API_KEY || 'dispatcher-secret-key';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function makeToken(driverId: string, name: string) {
  return jwt.sign({ sub: driverId, name }, JWT_SECRET, { expiresIn: '1h' });
}

const alexToken   = makeToken(DRIVER_IDS.alex,   'Alex Rivera');
const jordanToken = makeToken(DRIVER_IDS.jordan,  'Jordan Kim');

const SAMPLE_DELIVERY = {
  pickup_address:  'McDonald\'s - 100 Main St',
  pickup_lat:       37.7749,
  pickup_lng:      -122.4194,
  dropoff_address: '123 Oak Ave',
  dropoff_lat:      37.7690,
  dropoff_lng:     -122.4270,
  item_description: 'Big Mac + fries',
};

beforeEach(async () => { await resetDb(); });
afterAll(async () => { httpServer.close(); await db.end(); });

// ─── List deliveries ─────────────────────────────────────────────────────────

describe('GET /deliveries', () => {
  test('empty list on fresh DB', async () => {
    const res = await request(app)
      .get('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.deliveries).toHaveLength(0);
  });

  test('no dispatcher key → 401', async () => {
    const res = await request(app).get('/deliveries');
    expect(res.status).toBe(401);
  });
});

// ─── Create delivery ─────────────────────────────────────────────────────────

describe('POST /deliveries', () => {
  test('valid request → 201, pending status, estimated_minutes > 0', async () => {
    const res = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);

    expect(res.status).toBe(201);
    expect(res.body.delivery.status).toBe('pending');
    // PostgreSQL NUMERIC is returned as a string by the pg driver
    expect(parseFloat(res.body.delivery.estimated_minutes)).toBeGreaterThan(0);
    expect(res.body.delivery.item_description).toBe('Big Mac + fries');
    expect(res.body.delivery.timeout_seconds).toBe(60);
  });

  test('reads timeout from settings', async () => {
    await db.query(`UPDATE settings SET value = '30' WHERE key = 'request_timeout_seconds'`);
    const res = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);

    expect(res.status).toBe(201);
    expect(res.body.delivery.timeout_seconds).toBe(30);
  });

  test('missing pickup_lat → 400', async () => {
    const { pickup_lat: _omit, ...payload } = SAMPLE_DELIVERY;
    const res = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(payload);

    expect(res.status).toBe(400);
  });

  test('missing item_description → 400', async () => {
    const { item_description: _omit, ...payload } = SAMPLE_DELIVERY;
    const res = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(payload);

    expect(res.status).toBe(400);
  });

  test('no dispatcher key → 401', async () => {
    const res = await request(app)
      .post('/deliveries')
      .send(SAMPLE_DELIVERY);

    expect(res.status).toBe(401);
  });

  test('creates delivery_score broadcast records for online drivers', async () => {
    // Put Alex online
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);

    const res = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);

    expect(res.status).toBe(201);
    const deliveryId = res.body.delivery.id;

    const scoreRows = await db.query(
      `SELECT * FROM delivery_scores WHERE delivery_id = $1`,
      [deliveryId]
    );
    // Only Alex was online
    expect(scoreRows.rows).toHaveLength(1);
    expect(scoreRows.rows[0].driver_id).toBe(DRIVER_IDS.alex);
    expect(scoreRows.rows[0].accepted).toBe(false);
  });
});

// ─── Accept delivery ─────────────────────────────────────────────────────────

describe('POST /deliveries/:id/accept', () => {
  async function createDelivery() {
    const res = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);
    return res.body.delivery.id as string;
  }

  test('driver accepts → 200, status = assigned, driver_id set', async () => {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    const deliveryId = await createDelivery();

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    expect(res.status).toBe(200);
    expect(res.body.delivery.status).toBe('assigned');
    expect(res.body.delivery.driver_id).toBe(DRIVER_IDS.alex);
    expect(res.body.delivery.accepted_at).toBeTruthy();
  });

  test('driver status becomes busy after accept', async () => {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    const deliveryId = await createDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    const row = await db.query(`SELECT status FROM drivers WHERE id = $1`, [DRIVER_IDS.alex]);
    expect(row.rows[0].status).toBe('busy');
  });

  test('delivery_score accepted flag set to true', async () => {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    const deliveryId = await createDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    const row = await db.query(
      `SELECT accepted FROM delivery_scores WHERE delivery_id = $1 AND driver_id = $2`,
      [deliveryId, DRIVER_IDS.alex]
    );
    expect(row.rows[0].accepted).toBe(true);
  });

  test('second accept on already-assigned delivery → 409', async () => {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.jordan]);
    const deliveryId = await createDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${jordanToken}`);

    expect(res.status).toBe(409);
  });

  test('busy driver cannot accept another delivery → 409', async () => {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    const d1 = await createDelivery();
    const d2 = await createDelivery();

    await request(app)
      .post(`/deliveries/${d1}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    const res = await request(app)
      .post(`/deliveries/${d2}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    expect(res.status).toBe(409);
  });

  test('no auth → 401', async () => {
    const deliveryId = await createDelivery();
    const res = await request(app).post(`/deliveries/${deliveryId}/accept`);
    expect(res.status).toBe(401);
  });
});

// ─── Complete delivery ────────────────────────────────────────────────────────

describe('POST /deliveries/:id/complete', () => {
  async function setupActiveDelivery() {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    const created = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);
    const deliveryId = created.body.delivery.id as string;

    await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    return deliveryId;
  }

  test('complete own delivery → 200, status = completed', async () => {
    const deliveryId = await setupActiveDelivery();

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${alexToken}`);

    expect(res.status).toBe(200);
    expect(res.body.delivery.status).toBe('completed');
    expect(res.body.delivery.completed_at).toBeTruthy();
  });

  test('driver status returns to online after completion', async () => {
    const deliveryId = await setupActiveDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${alexToken}`);

    const row = await db.query(`SELECT status FROM drivers WHERE id = $1`, [DRIVER_IDS.alex]);
    expect(row.rows[0].status).toBe('online');
  });

  test('score record marked completed and on_time populated', async () => {
    const deliveryId = await setupActiveDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${alexToken}`);

    const row = await db.query(
      `SELECT completed, on_time FROM delivery_scores WHERE delivery_id = $1 AND driver_id = $2`,
      [deliveryId, DRIVER_IDS.alex]
    );
    expect(row.rows[0].completed).toBe(true);
    expect(row.rows[0].on_time).not.toBeNull();
  });

  test('driver safety_score is calculated and stored', async () => {
    const deliveryId = await setupActiveDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${alexToken}`);

    const row = await db.query(`SELECT safety_score FROM drivers WHERE id = $1`, [DRIVER_IDS.alex]);
    expect(row.rows[0].safety_score).not.toBeNull();
    expect(parseFloat(row.rows[0].safety_score)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(row.rows[0].safety_score)).toBeLessThanOrEqual(100);
  });

  test('wrong driver cannot complete → 404', async () => {
    const deliveryId = await setupActiveDelivery();

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${jordanToken}`);

    expect(res.status).toBe(404);
  });

  test('complete already-completed delivery → 404', async () => {
    const deliveryId = await setupActiveDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${alexToken}`);

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${alexToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── Cancel delivery ──────────────────────────────────────────────────────────

describe('POST /deliveries/:id/cancel', () => {
  test('cancel pending delivery → 200, status = cancelled', async () => {
    const created = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);
    const deliveryId = created.body.delivery.id;

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/cancel`)
      .set('x-dispatcher-key', DISPATCHER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.delivery.status).toBe('cancelled');
    expect(res.body.delivery.cancelled_at).toBeTruthy();
  });

  test('cancel already-completed → 404', async () => {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    const created = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);
    const deliveryId = created.body.delivery.id;

    await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    await request(app)
      .post(`/deliveries/${deliveryId}/complete`)
      .set('Authorization', `Bearer ${alexToken}`);

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/cancel`)
      .set('x-dispatcher-key', DISPATCHER_KEY);

    expect(res.status).toBe(404);
  });

  test('no dispatcher key → 401', async () => {
    const created = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);

    const res = await request(app)
      .post(`/deliveries/${created.body.delivery.id}/cancel`);

    expect(res.status).toBe(401);
  });
});

// ─── Location ping ────────────────────────────────────────────────────────────

describe('POST /deliveries/:id/location', () => {
  async function setupAssignedDelivery() {
    await db.query(`UPDATE drivers SET status = 'online' WHERE id = $1`, [DRIVER_IDS.alex]);
    const created = await request(app)
      .post('/deliveries')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send(SAMPLE_DELIVERY);
    const deliveryId = created.body.delivery.id as string;

    await request(app)
      .post(`/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${alexToken}`);

    return deliveryId;
  }

  test('valid location ping → 200', async () => {
    const deliveryId = await setupAssignedDelivery();

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/location`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ lat: 37.776, lng: -122.418 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('first location ping transitions delivery to active', async () => {
    const deliveryId = await setupAssignedDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/location`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ lat: 37.776, lng: -122.418 });

    const row = await db.query(`SELECT status FROM deliveries WHERE id = $1`, [deliveryId]);
    expect(row.rows[0].status).toBe('active');
  });

  test('location event persisted to DB', async () => {
    const deliveryId = await setupAssignedDelivery();

    await request(app)
      .post(`/deliveries/${deliveryId}/location`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ lat: 37.776, lng: -122.418 });

    const rows = await db.query(
      `SELECT lat, lng FROM location_events WHERE delivery_id = $1`,
      [deliveryId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].lat).toBeCloseTo(37.776, 3);
    expect(rows.rows[0].lng).toBeCloseTo(-122.418, 3);
  });

  test('wrong driver cannot send location → 403', async () => {
    const deliveryId = await setupAssignedDelivery();

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/location`)
      .set('Authorization', `Bearer ${jordanToken}`)
      .send({ lat: 37.776, lng: -122.418 });

    expect(res.status).toBe(403);
  });

  test('missing lat/lng → 400', async () => {
    const deliveryId = await setupAssignedDelivery();

    const res = await request(app)
      .post(`/deliveries/${deliveryId}/location`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ lat: 37.776 });

    expect(res.status).toBe(400);
  });
});

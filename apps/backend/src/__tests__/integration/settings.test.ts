import request from 'supertest';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app, httpServer } = buildApp();
const DISPATCHER_KEY = process.env.DISPATCHER_API_KEY || 'dispatcher-secret-key';

beforeEach(async () => { await resetDb(); });
afterAll(async () => { httpServer.close(); await db.end(); });

describe('GET /settings', () => {
  test('returns settings map with default timeout', async () => {
    const res = await request(app)
      .get('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.settings.request_timeout_seconds).toBe('60');
  });

  test('no dispatcher key → 401', async () => {
    const res = await request(app).get('/settings');
    expect(res.status).toBe(401);
  });
});

describe('PUT /settings', () => {
  test('update timeout → 200, returns updated value', async () => {
    const res = await request(app)
      .put('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send({ key: 'request_timeout_seconds', value: '30' });

    expect(res.status).toBe(200);
    expect(res.body.setting.value).toBe('30');
  });

  test('persisted — GET returns new value after PUT', async () => {
    await request(app)
      .put('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send({ key: 'request_timeout_seconds', value: '45' });

    const res = await request(app)
      .get('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY);

    expect(res.body.settings.request_timeout_seconds).toBe('45');
  });

  test('timeout below minimum (4) → 400', async () => {
    const res = await request(app)
      .put('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send({ key: 'request_timeout_seconds', value: '4' });

    expect(res.status).toBe(400);
  });

  test('timeout at minimum (5) → 200', async () => {
    const res = await request(app)
      .put('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send({ key: 'request_timeout_seconds', value: '5' });

    expect(res.status).toBe(200);
  });

  test('timeout above maximum (3601) → 400', async () => {
    const res = await request(app)
      .put('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send({ key: 'request_timeout_seconds', value: '3601' });

    expect(res.status).toBe(400);
  });

  test('timeout at maximum (3600) → 200', async () => {
    const res = await request(app)
      .put('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send({ key: 'request_timeout_seconds', value: '3600' });

    expect(res.status).toBe(200);
  });

  test('missing key → 400', async () => {
    const res = await request(app)
      .put('/settings')
      .set('x-dispatcher-key', DISPATCHER_KEY)
      .send({ value: '30' });

    expect(res.status).toBe(400);
  });

  test('no dispatcher key → 401', async () => {
    const res = await request(app)
      .put('/settings')
      .send({ key: 'request_timeout_seconds', value: '30' });

    expect(res.status).toBe(401);
  });
});

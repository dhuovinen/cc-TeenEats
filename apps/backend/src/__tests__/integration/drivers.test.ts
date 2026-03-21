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

beforeAll(async () => { await resetDb(); });
afterAll(async () => { httpServer.close(); await db.end(); });

describe('GET /drivers', () => {
  test('valid dispatcher key → 200 with all 3 drivers', async () => {
    const res = await request(app)
      .get('/drivers')
      .set('x-dispatcher-key', DISPATCHER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.drivers).toHaveLength(3);
    expect(res.body.drivers.map((d: { name: string }) => d.name).sort()).toEqual([
      'Alex Rivera', 'Jordan Kim', 'Sam Chen',
    ]);
  });

  test('no dispatcher key → 401', async () => {
    const res = await request(app).get('/drivers');
    expect(res.status).toBe(401);
  });

  test('wrong dispatcher key → 401', async () => {
    const res = await request(app)
      .get('/drivers')
      .set('x-dispatcher-key', 'bad-key');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /drivers/:id/status', () => {
  const alexToken = makeToken(DRIVER_IDS.alex, 'Alex Rivera');

  test('go online → 200, status = online', async () => {
    const res = await request(app)
      .patch(`/drivers/${DRIVER_IDS.alex}/status`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ status: 'online' });

    expect(res.status).toBe(200);
    expect(res.body.driver.status).toBe('online');
  });

  test('go offline → 200, status = offline', async () => {
    const res = await request(app)
      .patch(`/drivers/${DRIVER_IDS.alex}/status`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ status: 'offline' });

    expect(res.status).toBe(200);
    expect(res.body.driver.status).toBe('offline');
  });

  test('update another driver → 403', async () => {
    const res = await request(app)
      .patch(`/drivers/${DRIVER_IDS.jordan}/status`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ status: 'online' });

    expect(res.status).toBe(403);
  });

  test('invalid status value → 400', async () => {
    const res = await request(app)
      .patch(`/drivers/${DRIVER_IDS.alex}/status`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ status: 'eating' });

    expect(res.status).toBe(400);
  });

  test('no auth token → 401', async () => {
    const res = await request(app)
      .patch(`/drivers/${DRIVER_IDS.alex}/status`)
      .send({ status: 'online' });

    expect(res.status).toBe(401);
  });

  test('expired token → 401', async () => {
    const expired = jwt.sign(
      { sub: DRIVER_IDS.alex, name: 'Alex Rivera' },
      JWT_SECRET,
      { expiresIn: -1 }
    );
    const res = await request(app)
      .patch(`/drivers/${DRIVER_IDS.alex}/status`)
      .set('Authorization', `Bearer ${expired}`)
      .send({ status: 'online' });

    expect(res.status).toBe(401);
  });
});

describe('GET /drivers/:id/score', () => {
  const alexToken = makeToken(DRIVER_IDS.alex, 'Alex Rivera');

  test('fresh driver with no deliveries → null overall, 0 total', async () => {
    const res = await request(app)
      .get(`/drivers/${DRIVER_IDS.alex}/score`)
      .set('Authorization', `Bearer ${alexToken}`);

    expect(res.status).toBe(200);
    expect(res.body.score.overall).toBeNull();
    expect(res.body.score.totalDeliveries).toBe(0);
  });

  test('cannot get another driver score → 403', async () => {
    const res = await request(app)
      .get(`/drivers/${DRIVER_IDS.jordan}/score`)
      .set('Authorization', `Bearer ${alexToken}`);

    expect(res.status).toBe(403);
  });
});

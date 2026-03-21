import request from 'supertest';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app, httpServer } = buildApp();

beforeAll(async () => { await resetDb(); });
afterAll(async () => { httpServer.close(); await db.end(); });

describe('POST /auth/login', () => {
  test('valid credentials → 200 with token and driver', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'alex@teeneats.test', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.driver.email).toBe('alex@teeneats.test');
    expect(res.body.driver.name).toBe('Alex Rivera');
    expect(res.body.driver.password_hash).toBeUndefined();
  });

  test('email case-insensitive', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ALEX@TEENEATS.TEST', password: 'password123' });
    expect(res.status).toBe(200);
  });

  test('wrong password → 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'alex@teeneats.test', password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  test('unknown email → 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  test('missing password → 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'alex@teeneats.test' });
    expect(res.status).toBe(400);
  });

  test('empty body → 400', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

/**
 * Integration tests for Auth v2 routes.
 * Covers: driver registration, customer registration, email verification,
 * parental consent, multi-role login, token refresh, /me, logout.
 */
import request from 'supertest';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app, httpServer } = buildApp();

beforeAll(async () => { await resetDb(); });
afterAll(async () => { httpServer.close(); await db.end(); });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerDriver(overrides: Record<string, string> = {}) {
  const payload = {
    email:         'driver1@teeneats.test',
    password:      'SecurePass1',
    full_name:     'Alex Driver',
    date_of_birth: '2005-01-15',   // 21 years old in 2026
    state:         'CA',
    city:          'Los Angeles',
    parent_email:  'parent1@teeneats.test',
    ...overrides,
  };
  return request(app).post('/auth/v2/register/driver').send(payload);
}

async function registerCustomer(overrides: Record<string, string> = {}) {
  const payload = {
    email:     'customer1@teeneats.test',
    password:  'SecurePass1',
    full_name: 'Jane Customer',
    ...overrides,
  };
  return request(app).post('/auth/v2/register/customer').send(payload);
}

// ─── Driver registration ──────────────────────────────────────────────────────

describe('POST /auth/v2/register/driver', () => {
  test('valid registration → 201 with userId and dev tokens', async () => {
    const res = await registerDriver();
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeTruthy();
    expect(res.body._dev.emailVerifyToken).toBeTruthy();
    expect(res.body._dev.consentToken).toBeTruthy();
  });

  test('duplicate email → 409', async () => {
    const res = await registerDriver();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  test('weak password (no uppercase) → 400', async () => {
    const res = await registerDriver({ email: 'new@t.com', password: 'lowercase1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase/i);
  });

  test('weak password (too short) → 400', async () => {
    const res = await registerDriver({ email: 'new@t.com', password: 'Ab1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });

  test('weak password (no number) → 400', async () => {
    const res = await registerDriver({ email: 'new@t.com', password: 'SecurePass' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/number/i);
  });

  test('under 16 years old → 400', async () => {
    const res = await registerDriver({
      email:         'kid@t.com',
      date_of_birth: '2015-01-01',   // 11 years old
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/16/i);
  });

  test('parent_email same as driver email → 400', async () => {
    const res = await registerDriver({
      email:        'same@t.com',
      parent_email: 'same@t.com',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same/i);
  });

  test('missing required field (parent_email) → 400', async () => {
    const res = await request(app).post('/auth/v2/register/driver').send({
      email:         'x@t.com',
      password:      'SecurePass1',
      full_name:     'Test',
      date_of_birth: '2004-01-01',
      state:         'CA',
      city:          'SF',
      // parent_email intentionally missing
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent_email/i);
  });

  test('invalid state code → 400', async () => {
    const res = await registerDriver({ email: 'new2@t.com', state: 'California' });
    expect(res.status).toBe(400);
  });

  test('creates driver_profiles and consent_tokens records', async () => {
    const res = await registerDriver({ email: 'driver2@teeneats.test', parent_email: 'parent2@teeneats.test' });
    expect(res.status).toBe(201);

    const profileRow = await db.query(
      `SELECT dp.state, dp.city FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id WHERE u.email_lower = 'driver2@teeneats.test'`
    );
    expect(profileRow.rows[0].state).toBe('CA');

    const tokenRow = await db.query(
      `SELECT ct.token FROM consent_tokens ct
       JOIN users u ON u.id = ct.driver_user_id WHERE u.email_lower = 'driver2@teeneats.test'`
    );
    expect(tokenRow.rows[0].token).toBeTruthy();
  });
});

// ─── Customer registration ────────────────────────────────────────────────────

describe('POST /auth/v2/register/customer', () => {
  test('valid registration → 201', async () => {
    const res = await registerCustomer();
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeTruthy();
    expect(res.body._dev.emailVerifyToken).toBeTruthy();
  });

  test('duplicate email → 409', async () => {
    const res = await registerCustomer();
    expect(res.status).toBe(409);
  });

  test('weak password → 400', async () => {
    const res = await registerCustomer({ email: 'c2@t.com', password: 'weak' });
    expect(res.status).toBe(400);
  });

  test('missing full_name → 400', async () => {
    const res = await request(app).post('/auth/v2/register/customer').send({
      email: 'c3@t.com', password: 'SecurePass1',
    });
    expect(res.status).toBe(400);
  });
});

// ─── Email verification ───────────────────────────────────────────────────────

describe('POST /auth/v2/verify-email/:token', () => {
  let emailToken: string;

  beforeAll(async () => {
    const res = await registerDriver({ email: 'verify@teeneats.test', parent_email: 'vp@t.com' });
    emailToken = res.body._dev.emailVerifyToken;
  });

  test('valid token → 200, email marked verified', async () => {
    const res = await request(app).post(`/auth/v2/verify-email/${emailToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);

    const row = await db.query(
      `SELECT email_verified FROM users WHERE email_lower = 'verify@teeneats.test'`
    );
    expect(row.rows[0].email_verified).toBe(true);
  });

  test('same token again → idempotent 200', async () => {
    // Token is cleared after use, so it should return 400 now
    const res = await request(app).post(`/auth/v2/verify-email/${emailToken}`);
    expect(res.status).toBe(400);
  });

  test('invalid token → 400', async () => {
    const res = await request(app).post('/auth/v2/verify-email/bad-token-value');
    expect(res.status).toBe(400);
  });
});

// ─── Parental consent ─────────────────────────────────────────────────────────

describe('POST /auth/v2/consent/:token', () => {
  let consentToken: string;

  beforeAll(async () => {
    const res = await registerDriver({ email: 'consent-driver@teeneats.test', parent_email: 'consent-parent@teeneats.test' });
    consentToken = res.body._dev.consentToken;
  });

  test('missing password/full_name → 400', async () => {
    const res = await request(app).post(`/auth/v2/consent/${consentToken}`).send({});
    expect(res.status).toBe(400);
  });

  test('weak password → 400', async () => {
    const res = await request(app)
      .post(`/auth/v2/consent/${consentToken}`)
      .send({ password: 'weak', full_name: 'Parent One' });
    expect(res.status).toBe(400);
  });

  test('valid token + strong password → 200, creates parent account', async () => {
    const res = await request(app)
      .post(`/auth/v2/consent/${consentToken}`)
      .send({ password: 'SecureParent1', full_name: 'Parent One' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.role).toBe('parent');

    // Driver profile should now show consent_approved = true
    const row = await db.query(
      `SELECT dp.consent_approved FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id WHERE u.email_lower = 'consent-driver@teeneats.test'`
    );
    expect(row.rows[0].consent_approved).toBe(true);
  });

  test('already-used token → 400', async () => {
    const res = await request(app)
      .post(`/auth/v2/consent/${consentToken}`)
      .send({ password: 'SecureParent1', full_name: 'Parent One' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already used/i);
  });

  test('invalid token → 400', async () => {
    const res = await request(app)
      .post('/auth/v2/consent/not-a-real-token')
      .send({ password: 'SecureParent1', full_name: 'Test' });
    expect(res.status).toBe(400);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────

describe('POST /auth/v2/login', () => {
  beforeAll(async () => {
    // Ensure we have driver + customer accounts
    // (already created earlier in this suite via beforeAll chain)
  });

  test('driver login → 200 with accessToken, refreshToken, driver profile', async () => {
    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'driver1@teeneats.test', password: 'SecurePass1' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.role).toBe('driver');
    expect(res.body.user.state).toBe('CA');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('customer login → 200 with correct role', async () => {
    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'customer1@teeneats.test', password: 'SecurePass1' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('customer');
  });

  test('parent login (after consent) → 200 with parent role', async () => {
    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'consent-parent@teeneats.test', password: 'SecureParent1' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('parent');
  });

  test('wrong password → 401', async () => {
    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'driver1@teeneats.test', password: 'WrongPass1' });
    expect(res.status).toBe(401);
  });

  test('unknown email → 401', async () => {
    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'nobody@t.com', password: 'SecurePass1' });
    expect(res.status).toBe(401);
  });

  test('missing fields → 400', async () => {
    const res = await request(app).post('/auth/v2/login').send({ email: 'x@t.com' });
    expect(res.status).toBe(400);
  });

  test('deactivated account → 403', async () => {
    await request(app).post('/auth/v2/register/driver').send({
      email:         'deactivated@teeneats.test',
      password:      'SecurePass1',
      full_name:     'Deactivated User',
      date_of_birth: '2004-01-01',
      state:         'NY',
      city:          'NYC',
      parent_email:  'dp@t.com',
    });
    await db.query(`UPDATE users SET active = FALSE WHERE email_lower = 'deactivated@teeneats.test'`);

    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'deactivated@teeneats.test', password: 'SecurePass1' });
    expect(res.status).toBe(403);
  });
});

// ─── Token refresh ────────────────────────────────────────────────────────────

describe('POST /auth/v2/refresh', () => {
  let refreshToken: string;
  let accessToken: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'customer1@teeneats.test', password: 'SecurePass1' });
    refreshToken = res.body.refreshToken;
    accessToken  = res.body.accessToken;
  });

  test('valid refresh token → 200, new access + refresh tokens', async () => {
    const res = await request(app)
      .post('/auth/v2/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    // New tokens should be different
    expect(res.body.refreshToken).not.toBe(refreshToken);

    // Save new token for next test
    refreshToken = res.body.refreshToken;
  });

  test('reused (revoked) refresh token → 401', async () => {
    // The original refreshToken was rotated above and should now be revoked
    const res = await request(app)
      .post('/auth/v2/refresh')
      .send({ refreshToken: refreshToken + 'tampered' });
    expect(res.status).toBe(401);
  });

  test('missing refreshToken → 400', async () => {
    const res = await request(app).post('/auth/v2/refresh').send({});
    expect(res.status).toBe(400);
  });
});

// ─── /me ──────────────────────────────────────────────────────────────────────

describe('GET /auth/v2/me', () => {
  let driverToken: string;
  let customerToken: string;
  let parentToken: string;

  beforeAll(async () => {
    const dr = await request(app).post('/auth/v2/login')
      .send({ email: 'driver1@teeneats.test', password: 'SecurePass1' });
    driverToken = dr.body.accessToken;

    const cu = await request(app).post('/auth/v2/login')
      .send({ email: 'customer1@teeneats.test', password: 'SecurePass1' });
    customerToken = cu.body.accessToken;

    const pa = await request(app).post('/auth/v2/login')
      .send({ email: 'consent-parent@teeneats.test', password: 'SecureParent1' });
    parentToken = pa.body.accessToken;
  });

  test('driver /me → includes state, city, status', async () => {
    const res = await request(app)
      .get('/auth/v2/me')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('driver');
    expect(res.body.user.state).toBe('CA');
    expect(res.body.user.city).toBe('Los Angeles');
    expect(res.body.user.status).toBe('offline');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('customer /me → includes role=customer', async () => {
    const res = await request(app)
      .get('/auth/v2/me')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('customer');
  });

  test('parent /me → includes linked_drivers array', async () => {
    const res = await request(app)
      .get('/auth/v2/me')
      .set('Authorization', `Bearer ${parentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('parent');
    expect(Array.isArray(res.body.user.linked_drivers)).toBe(true);
    expect(res.body.user.linked_drivers.length).toBeGreaterThan(0);
  });

  test('no token → 401', async () => {
    const res = await request(app).get('/auth/v2/me');
    expect(res.status).toBe(401);
  });

  test('expired token → 401', async () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign(
      { sub: 'fake', role: 'driver', name: 'Fake' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: -1 }
    );
    const res = await request(app)
      .get('/auth/v2/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /auth/v2/logout', () => {
  let refreshToken: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/auth/v2/login')
      .send({ email: 'driver1@teeneats.test', password: 'SecurePass1' });
    refreshToken = res.body.refreshToken;
  });

  test('logout with valid token → 200', async () => {
    const res = await request(app)
      .post('/auth/v2/logout')
      .send({ refreshToken });
    expect(res.status).toBe(200);
  });

  test('subsequent refresh after logout → 401', async () => {
    const res = await request(app)
      .post('/auth/v2/refresh')
      .send({ refreshToken });
    expect(res.status).toBe(401);
  });

  test('missing refreshToken → 400', async () => {
    const res = await request(app).post('/auth/v2/logout').send({});
    expect(res.status).toBe(400);
  });
});

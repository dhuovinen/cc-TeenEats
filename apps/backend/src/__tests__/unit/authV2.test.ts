/**
 * Unit tests for auth v2 service — no DB required.
 */
import {
  validatePasswordStrength,
  generateEmailToken,
  generateConsentToken,
  issueAccessToken,
  verifyAccessToken,
} from '../../services/authV2';

describe('validatePasswordStrength', () => {
  test('valid password → null', () => {
    expect(validatePasswordStrength('Secure1password')).toBeNull();
  });

  test('too short → error', () => {
    expect(validatePasswordStrength('Abc1234')).toBeTruthy();
  });

  test('no uppercase → error', () => {
    expect(validatePasswordStrength('secure1password')).toBeTruthy();
  });

  test('no number → error', () => {
    expect(validatePasswordStrength('SecurePassword')).toBeTruthy();
  });

  test('exactly 8 chars, valid → null', () => {
    expect(validatePasswordStrength('Secure1!')).toBeNull();
  });

  test('7 chars, otherwise valid → error', () => {
    expect(validatePasswordStrength('Secur1!')).toBeTruthy();
  });
});

describe('generateEmailToken', () => {
  test('returns non-empty token', () => {
    const { token } = generateEmailToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  test('expires in the future (~24h)', () => {
    const { expires } = generateEmailToken();
    const msFromNow = expires.getTime() - Date.now();
    // Between 23 and 25 hours
    expect(msFromNow).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(msFromNow).toBeLessThan(25 * 60 * 60 * 1000);
  });

  test('two tokens are unique', () => {
    const a = generateEmailToken();
    const b = generateEmailToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('generateConsentToken', () => {
  test('returns non-empty token', () => {
    const { token } = generateConsentToken();
    expect(token.length).toBeGreaterThan(20);
  });

  test('expires ~72h from now', () => {
    const { expires } = generateConsentToken();
    const msFromNow = expires.getTime() - Date.now();
    expect(msFromNow).toBeGreaterThan(71 * 60 * 60 * 1000);
    expect(msFromNow).toBeLessThan(73 * 60 * 60 * 1000);
  });
});

describe('issueAccessToken / verifyAccessToken', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
  });

  test('issues token with correct sub and role', () => {
    const token = issueAccessToken('user-123', 'driver', 'Alex Rivera');
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.role).toBe('driver');
    expect(payload.name).toBe('Alex Rivera');
  });

  test('all four roles encode correctly', () => {
    for (const role of ['driver','customer','parent','admin'] as const) {
      const token = issueAccessToken('u', role, 'Test User');
      expect(verifyAccessToken(token).role).toBe(role);
    }
  });

  test('expired token throws', () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign(
      { sub: 'u', role: 'driver', name: 'Test' },
      'test-secret-for-unit-tests',
      { expiresIn: -1 }
    );
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  test('tampered token throws', () => {
    const token = issueAccessToken('u', 'driver', 'Test');
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'hacker', role: 'admin' }))
      .toString('base64url');
    expect(() => verifyAccessToken(parts.join('.'))).toThrow();
  });
});

/**
 * Auth v2 service — supports multi-role JWT, refresh tokens, parental consent.
 */
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db';

export type UserRole = 'driver' | 'customer' | 'parent' | 'admin';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  name: string;
  iat: number;
  exp: number;
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

export function issueAccessToken(
  userId: string,
  role: UserRole,
  name: string
): string {
  return jwt.sign(
    { sub: userId, role, name },
    process.env.JWT_SECRET as string,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_SECRET as string) as AccessTokenPayload;
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const raw   = crypto.randomBytes(64).toString('hex');
  const hash  = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
  return raw;
}

export async function rotateRefreshToken(
  rawToken: string
): Promise<{ userId: string; newRaw: string } | null> {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { rows } = await db.query(
    `SELECT id, user_id, expires_at, revoked_at
     FROM refresh_tokens WHERE token_hash = $1`,
    [hash]
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
    return null;
  }

  // Revoke old token
  await db.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row.id]);

  // Issue new one
  const newRaw = await issueRefreshToken(row.user_id);
  return { userId: row.user_id, newRaw };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [hash]
  );
}

// ─── Passwords ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8)  return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

// ─── Email verification ───────────────────────────────────────────────────────

const EMAIL_VERIFY_TTL_HOURS = 24;

export function generateEmailToken(): { token: string; expires: Date } {
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000);
  return { token, expires };
}

// ─── Consent tokens ───────────────────────────────────────────────────────────

const CONSENT_TOKEN_TTL_HOURS = 72;

export function generateConsentToken(): { token: string; expires: Date } {
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + CONSENT_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  return { token, expires };
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function findUserById(id: string) {
  const { rows } = await db.query(
    `SELECT id, email, role, full_name, email_verified, active FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string) {
  const { rows } = await db.query(
    `SELECT id, email, role, full_name, email_verified, active, password_hash
     FROM users WHERE email_lower = $1`,
    [email.toLowerCase().trim()]
  );
  return rows[0] ?? null;
}

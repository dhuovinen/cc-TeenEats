/**
 * Auth v2 routes — multi-role registration, login, consent, refresh, logout.
 * Mounted at /auth/v2
 */
import { Router, Request, Response } from 'express';
import { db } from '../db';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyAccessToken,
  generateEmailToken,
  generateConsentToken,
  findUserById,
  findUserByEmail,
} from '../services/authV2';
import { requireAuthV2 } from '../middleware/authV2';

const router = Router();

// ─── POST /auth/v2/register/driver ────────────────────────────────────────────
router.post('/register/driver', async (req: Request, res: Response) => {
  const {
    email,
    password,
    full_name,
    date_of_birth,
    state,
    city,
    parent_email,
  } = req.body as Record<string, string | undefined>;

  // Validate required fields
  const missing = ['email','password','full_name','date_of_birth','state','city','parent_email']
    .filter(k => !req.body[k]);
  if (missing.length) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    return;
  }

  const pwError = validatePasswordStrength(password!);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }

  // Age check: must be 16+
  const dob = new Date(date_of_birth!);
  if (isNaN(dob.getTime())) {
    res.status(400).json({ error: 'Invalid date_of_birth' });
    return;
  }
  const ageMs = Date.now() - dob.getTime();
  const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 16) {
    res.status(400).json({ error: 'Drivers must be at least 16 years old' });
    return;
  }

  // State must be 2-letter
  if (!/^[A-Z]{2}$/.test(state!.toUpperCase())) {
    res.status(400).json({ error: 'state must be a 2-letter US state code' });
    return;
  }

  // parent_email cannot equal driver email
  if (email!.toLowerCase().trim() === parent_email!.toLowerCase().trim()) {
    res.status(400).json({ error: 'parent_email cannot be the same as driver email' });
    return;
  }

  try {
    // Check for duplicate email
    const existing = await findUserByEmail(email!);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await hashPassword(password!);
    const { token: emailToken, expires: emailExpires } = generateEmailToken();
    const { token: consentToken, expires: consentExpires } = generateConsentToken();

    const client = await (db as any).connect();
    try {
      await client.query('BEGIN');

      // 1. Create user record
      const userRes = await client.query(
        `INSERT INTO users
           (email, password_hash, role, full_name, email_verify_token, email_verify_exp)
         VALUES ($1, $2, 'driver', $3, $4, $5)
         RETURNING id`,
        [email!.trim(), passwordHash, full_name!.trim(), emailToken, emailExpires]
      );
      const userId: string = userRes.rows[0].id;

      // 2. Create driver profile
      await client.query(
        `INSERT INTO driver_profiles (user_id, date_of_birth, state, city)
         VALUES ($1, $2, $3, $4)`,
        [userId, dob.toISOString().split('T')[0], state!.toUpperCase(), city!.trim()]
      );

      // 3. Create consent token
      await client.query(
        `INSERT INTO consent_tokens (token, driver_user_id, parent_email, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [consentToken, userId, parent_email!.toLowerCase().trim(), consentExpires]
      );

      // 4. Create driver-parent link (no parent account yet)
      await client.query(
        `INSERT INTO driver_parent_links (driver_user_id, parent_email)
         VALUES ($1, $2)`,
        [userId, parent_email!.toLowerCase().trim()]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Driver account created. Check your email to verify your address, and a consent request has been sent to your parent.',
        userId,
        // In production these tokens would be emailed, not returned in the response.
        // For MVP/test we include them so tests can complete flows end-to-end.
        _dev: {
          emailVerifyToken: emailToken,
          consentToken,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[authV2] register/driver error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/v2/register/customer ─────────────────────────────────────────
router.post('/register/customer', async (req: Request, res: Response) => {
  const { email, password, full_name } = req.body as Record<string, string | undefined>;

  const missing = ['email','password','full_name'].filter(k => !req.body[k]);
  if (missing.length) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    return;
  }

  const pwError = validatePasswordStrength(password!);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }

  try {
    const existing = await findUserByEmail(email!);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await hashPassword(password!);
    const { token: emailToken, expires: emailExpires } = generateEmailToken();

    const client = await (db as any).connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `INSERT INTO users
           (email, password_hash, role, full_name, email_verify_token, email_verify_exp)
         VALUES ($1, $2, 'customer', $3, $4, $5)
         RETURNING id`,
        [email!.trim(), passwordHash, full_name!.trim(), emailToken, emailExpires]
      );
      const userId: string = userRes.rows[0].id;

      await client.query(
        `INSERT INTO customer_profiles (user_id) VALUES ($1)`,
        [userId]
      );

      await client.query('COMMIT');
      res.status(201).json({
        message: 'Customer account created. Check your email to verify your address.',
        userId,
        _dev: { emailVerifyToken: emailToken },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[authV2] register/customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/v2/verify-email/:token ────────────────────────────────────────
router.post('/verify-email/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT id, email_verified, email_verify_exp FROM users WHERE email_verify_token = $1`,
      [token]
    );
    const user = rows[0];
    if (!user) {
      res.status(400).json({ error: 'Invalid or expired verification token' });
      return;
    }
    if (user.email_verified) {
      res.json({ message: 'Email already verified' });
      return;
    }
    if (new Date(user.email_verify_exp) < new Date()) {
      res.status(400).json({ error: 'Verification token has expired' });
      return;
    }

    await db.query(
      `UPDATE users SET email_verified = TRUE, email_verify_token = NULL, email_verify_exp = NULL
       WHERE id = $1`,
      [user.id]
    );
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error('[authV2] verify-email error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/v2/consent/:token ─────────────────────────────────────────────
router.post('/consent/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const { password, full_name } = req.body as Record<string, string | undefined>;

  // Parent must provide their own name + password to create an account alongside consent
  if (!password || !full_name) {
    res.status(400).json({ error: 'password and full_name required to create parent account' });
    return;
  }

  const pwError = validatePasswordStrength(password);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }

  try {
    const { rows } = await db.query(
      `SELECT ct.*, u.full_name as driver_name
       FROM consent_tokens ct
       JOIN users u ON u.id = ct.driver_user_id
       WHERE ct.token = $1`,
      [token]
    );
    const ct = rows[0];
    if (!ct) {
      res.status(400).json({ error: 'Invalid consent token' });
      return;
    }
    if (ct.used_at) {
      res.status(400).json({ error: 'Consent token already used' });
      return;
    }
    if (new Date(ct.expires_at) < new Date()) {
      res.status(400).json({ error: 'Consent token has expired' });
      return;
    }

    const passwordHash = await hashPassword(password);

    const client = await (db as any).connect();
    try {
      await client.query('BEGIN');

      // Check if parent already has an account (re-consent scenario)
      let parentUserId: string;
      const existing = await findUserByEmail(ct.parent_email);
      if (existing && existing.role === 'parent') {
        parentUserId = existing.id;
      } else if (existing) {
        res.status(409).json({ error: 'This email is already registered with a different role' });
        await client.query('ROLLBACK');
        return;
      } else {
        const parentRes = await client.query(
          `INSERT INTO users (email, password_hash, role, full_name, email_verified)
           VALUES ($1, $2, 'parent', $3, TRUE)
           RETURNING id`,
          [ct.parent_email, passwordHash, full_name.trim()]
        );
        parentUserId = parentRes.rows[0].id;

        await client.query(
          `INSERT INTO parent_profiles (user_id) VALUES ($1)`,
          [parentUserId]
        );
      }

      // Update driver-parent link
      await client.query(
        `UPDATE driver_parent_links
         SET parent_user_id = $1, consent_status = 'approved', consented_at = NOW()
         WHERE driver_user_id = $2 AND parent_email = $3`,
        [parentUserId, ct.driver_user_id, ct.parent_email]
      );

      // Mark driver profile as consent approved
      await client.query(
        `UPDATE driver_profiles
         SET consent_approved = TRUE, consent_approved_at = NOW()
         WHERE user_id = $1`,
        [ct.driver_user_id]
      );

      // Mark token as used
      await client.query(
        `UPDATE consent_tokens SET used_at = NOW() WHERE id = $1`,
        [ct.id]
      );

      await client.query('COMMIT');

      const accessToken  = issueAccessToken(parentUserId, 'parent', full_name.trim());
      const refreshToken = await issueRefreshToken(parentUserId);

      res.json({
        message: `Consent approved for ${ct.driver_name}. Parent account created.`,
        accessToken,
        refreshToken,
        user: {
          id: parentUserId,
          role: 'parent',
          full_name: full_name.trim(),
          email: ct.parent_email,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[authV2] consent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/v2/login ──────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as Record<string, string | undefined>;
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    if (!user.active) {
      res.status(403).json({ error: 'Account is deactivated' });
      return;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Role-specific extra data
    let profile: Record<string, unknown> = {};
    if (user.role === 'driver') {
      const { rows } = await db.query(
        `SELECT status, consent_approved, safety_score, state, city
         FROM driver_profiles WHERE user_id = $1`,
        [user.id]
      );
      if (rows[0]) profile = rows[0];
    }

    const accessToken  = issueAccessToken(user.id, user.role, user.full_name);
    const refreshToken = await issueRefreshToken(user.id);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id:             user.id,
        role:           user.role,
        full_name:      user.full_name,
        email:          user.email,
        email_verified: user.email_verified,
        ...profile,
      },
    });
  } catch (err) {
    console.error('[authV2] login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/v2/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken required' });
    return;
  }
  try {
    const result = await rotateRefreshToken(refreshToken);
    if (!result) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    const user = await findUserById(result.userId);
    if (!user || !user.active) {
      res.status(401).json({ error: 'Account not found or deactivated' });
      return;
    }
    const accessToken = issueAccessToken(user.id, user.role, user.full_name);
    res.json({ accessToken, refreshToken: result.newRaw });
  } catch (err) {
    console.error('[authV2] refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /auth/v2/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuthV2, async (req: Request, res: Response) => {
  try {
    const user = await findUserById(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    let profile: Record<string, unknown> = {};
    if (user.role === 'driver') {
      const { rows } = await db.query(
        `SELECT status, consent_approved, safety_score, state, city, date_of_birth
         FROM driver_profiles WHERE user_id = $1`,
        [user.id]
      );
      if (rows[0]) profile = rows[0];
    } else if (user.role === 'parent') {
      const { rows } = await db.query(
        `SELECT dpl.driver_user_id, u.full_name as driver_name, dpl.consent_status
         FROM driver_parent_links dpl
         JOIN users u ON u.id = dpl.driver_user_id
         WHERE dpl.parent_user_id = $1`,
        [user.id]
      );
      profile = { linked_drivers: rows };
    } else if (user.role === 'customer') {
      const { rows } = await db.query(
        `SELECT phone FROM customer_profiles WHERE user_id = $1`,
        [user.id]
      );
      if (rows[0]) profile = rows[0];
    }

    res.json({
      user: {
        id:             user.id,
        role:           user.role,
        full_name:      user.full_name,
        email:          user.email,
        email_verified: user.email_verified,
        ...profile,
      },
    });
  } catch (err) {
    console.error('[authV2] me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/v2/logout ─────────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken required' });
    return;
  }
  try {
    await revokeRefreshToken(refreshToken);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('[authV2] logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

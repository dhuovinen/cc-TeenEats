import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  try {
    const result = await db.query(
      `SELECT id, name, email, password_hash, status, safety_score
       FROM drivers WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    const driver = result.rows[0];
    if (!driver) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, driver.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { sub: driver.id, name: driver.name },
      process.env.JWT_SECRET as string,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
        status: driver.status,
        safety_score: driver.safety_score,
      },
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

/**
 * Test DB helpers.
 * Uses the same DATABASE_URL as the main app — run against a test schema.
 * Each test suite calls resetDb() to wipe and re-seed before running.
 */
import bcrypt from 'bcrypt';
import { db } from '../../db';
import fs from 'fs';
import path from 'path';

export async function resetDb(): Promise<void> {
  // Drop and recreate tables
  await db.query(`
    DROP TABLE IF EXISTS delivery_scores CASCADE;
    DROP TABLE IF EXISTS location_events CASCADE;
    DROP TABLE IF EXISTS deliveries CASCADE;
    DROP TABLE IF EXISTS drivers CASCADE;
    DROP TABLE IF EXISTS settings CASCADE;
  `);

  const sql = fs.readFileSync(
    path.join(__dirname, '../../migrations/001_alpha_schema.sql'),
    'utf-8'
  );
  await db.query(sql);

  // Seed 3 test drivers
  const hash = await bcrypt.hash('password123', 1); // cost=1 for test speed
  await db.query(`
    INSERT INTO drivers (id, name, email, password_hash, status) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Alex Rivera',  'alex@teeneats.test',   $1, 'offline'),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Jordan Kim',   'jordan@teeneats.test', $1, 'offline'),
      ('aaaaaaaa-0000-0000-0000-000000000003', 'Sam Chen',     'sam@teeneats.test',    $1, 'offline')
  `, [hash]);

  await db.query(`
    INSERT INTO settings (key, value) VALUES ('request_timeout_seconds', '60')
    ON CONFLICT (key) DO UPDATE SET value = '60'
  `);
}

export const DRIVER_IDS = {
  alex:   'aaaaaaaa-0000-0000-0000-000000000001',
  jordan: 'aaaaaaaa-0000-0000-0000-000000000002',
  sam:    'aaaaaaaa-0000-0000-0000-000000000003',
} as const;

export { db };

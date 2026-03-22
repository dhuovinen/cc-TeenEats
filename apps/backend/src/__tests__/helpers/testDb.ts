/**
 * Test DB helpers.
 * Uses the same DATABASE_URL as the main app — run against a test schema.
 * Each test suite calls resetDb() to wipe and re-seed before running.
 */
import bcrypt from 'bcrypt';
import { db } from '../../db';
import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

export async function resetDb(): Promise<void> {
  // Drop all tables in reverse dependency order (v2 first, then alpha)
  await db.query(`
    DROP TABLE IF EXISTS compliance_violations CASCADE;
    DROP TABLE IF EXISTS work_sessions CASCADE;
    DROP TABLE IF EXISTS compliance_rules CASCADE;
    DROP TABLE IF EXISTS delivery_sessions CASCADE;
    DROP TABLE IF EXISTS order_items CASCADE;
    DROP TABLE IF EXISTS orders CASCADE;
    DROP TABLE IF EXISTS refresh_tokens CASCADE;
    DROP TABLE IF EXISTS consent_tokens CASCADE;
    DROP TABLE IF EXISTS driver_parent_links CASCADE;
    DROP TABLE IF EXISTS admin_profiles CASCADE;
    DROP TABLE IF EXISTS parent_profiles CASCADE;
    DROP TABLE IF EXISTS customer_profiles CASCADE;
    DROP TABLE IF EXISTS driver_profiles CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS delivery_scores CASCADE;
    DROP TABLE IF EXISTS location_events CASCADE;
    DROP TABLE IF EXISTS deliveries CASCADE;
    DROP TABLE IF EXISTS drivers CASCADE;
    DROP TABLE IF EXISTS settings CASCADE;
    DROP TABLE IF EXISTS menu_items CASCADE;
    DROP TABLE IF EXISTS menu_categories CASCADE;
    DROP TABLE IF EXISTS restaurant_hours CASCADE;
    DROP TABLE IF EXISTS restaurants CASCADE;
    DROP TABLE IF EXISTS schema_migrations CASCADE;
  `);

  // Ensure migration tracking table exists before running migrations
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Apply all migrations in order
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await db.query(sql);
  }

  // Seed alpha test drivers (for backward compatibility with existing tests)
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

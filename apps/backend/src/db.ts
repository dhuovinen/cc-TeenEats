import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined,
});

db.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('DB connection failed:', err);
    return false;
  }
}

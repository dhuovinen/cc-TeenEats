import { Pool, types } from 'pg';
import dotenv from 'dotenv';

// Return NUMERIC columns as JS floats (default is string to preserve precision,
// but our ETA/score values are small decimals where float64 is fine).
types.setTypeParser(types.builtins.NUMERIC, (val: string) => parseFloat(val));

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

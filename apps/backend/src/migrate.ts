import fs from 'fs';
import path from 'path';
import { db } from './db';

async function migrate() {
  const sqlPath = path.join(__dirname, 'migrations', '001_alpha_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  console.log('Running migration: 001_alpha_schema.sql');
  await db.query(sql);
  console.log('Migration complete.');
  await db.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

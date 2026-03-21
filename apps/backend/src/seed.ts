import bcrypt from 'bcrypt';
import { db } from './db';

const SEED_DRIVERS = [
  { name: 'Alex Rivera', email: 'alex@teeneats.test' },
  { name: 'Jordan Kim', email: 'jordan@teeneats.test' },
  { name: 'Sam Chen', email: 'sam@teeneats.test' },
];

const SEED_PASSWORD = 'password123';

async function seed() {
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);

  for (const driver of SEED_DRIVERS) {
    const result = await db.query(
      `INSERT INTO drivers (name, email, password_hash, status)
       VALUES ($1, $2, $3, 'offline')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, email`,
      [driver.name, driver.email, hash]
    );
    console.log(`Seeded driver: ${result.rows[0].name} (${result.rows[0].email}) [id: ${result.rows[0].id}]`);
  }

  // Ensure default settings
  await db.query(
    `INSERT INTO settings (key, value)
     VALUES ('request_timeout_seconds', '60')
     ON CONFLICT (key) DO NOTHING`
  );
  console.log('Settings initialized: request_timeout_seconds = 60');

  console.log(`\nAll drivers seeded with password: ${SEED_PASSWORD}`);
  await db.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

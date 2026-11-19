import { existsSync } from 'node:fs';
import postgres from 'postgres';
import { migrateAll } from '../src/server/migrate';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the PostgreSQL database to migrate.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const applied = await migrateAll(sql);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await sql.end();
}

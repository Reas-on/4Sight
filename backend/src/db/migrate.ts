import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDatabase, createPool } from './client.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env);

  try {
    const db = createDatabase(pool);
    const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
    await migrate(db, { migrationsFolder });
    console.log('Database migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error('Migration failed: check database availability and migration compatibility.');
  process.exitCode = 1;
});

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';
import { loadConfig } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/db → ../../drizzle, src/db → ../../drizzle
export const MIGRATIONS_DIR = path.resolve(here, '../../drizzle');

export async function runMigrations(url: string) {
  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cfg = loadConfig();
  runMigrations(cfg.DATABASE_URL)
    .then(() => console.log('Migrasi database selesai'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

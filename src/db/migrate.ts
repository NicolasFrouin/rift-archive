import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index.js';

/**
 * Applies all pending Drizzle migrations from ./drizzle. Invoked by the worker
 * on boot and runnable standalone via `pnpm db:migrate`.
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: 'drizzle' });
}

// Allow running directly: `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

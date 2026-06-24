import type { Config } from 'drizzle-kit';

// Build the URL from POSTGRES_* (matching src/env.ts) without importing env.ts,
// which would exit on a missing RIOT_API_KEY during `drizzle-kit generate`.
const url =
  process.env.DATABASE_URL ??
  `postgres://${process.env.POSTGRES_USER ?? 'rift'}:${process.env.POSTGRES_PASSWORD ?? 'change_me_please'}` +
    `@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5432'}/${process.env.POSTGRES_DB ?? 'lol'}`;

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
} satisfies Config;

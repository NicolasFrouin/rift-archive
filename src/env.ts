import { z } from 'zod';

/**
 * Single source of truth for runtime configuration. Validated once at process
 * start so the worker / CLI fail fast with a clear message on misconfiguration.
 *
 * DATABASE_URL is derived from the POSTGRES_* vars when not given explicitly, so
 * the Postgres password lives in exactly one place (POSTGRES_PASSWORD) and is
 * reused by the worker, the CLI, and Metabase.
 */
const schema = z.object({
  RIOT_API_KEY: z.string().min(1, 'RIOT_API_KEY is required (use a personal, non-expiring key)'),
  // SEA is excluded: it's invalid for the account-v1 endpoint and out of scope here.
  REGION_GROUP: z.enum(['EUROPE', 'AMERICAS', 'ASIA']).default('EUROPE'),
  DEFAULT_PLATFORM: z.string().default('euw1'),

  // Either set DATABASE_URL directly, or let it be built from the parts below.
  DATABASE_URL: z.string().url().optional(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().default('rift'),
  POSTGRES_PASSWORD: z.string().default('change_me_please'),
  POSTGRES_DB: z.string().default('lol'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

// Build the connection string from parts when not provided. Encode the password
// so special characters can't break the URL.
const databaseUrl =
  data.DATABASE_URL ??
  `postgres://${data.POSTGRES_USER}:${encodeURIComponent(data.POSTGRES_PASSWORD)}` +
    `@${data.POSTGRES_HOST}:${data.POSTGRES_PORT}/${data.POSTGRES_DB}`;

export const env = { ...data, DATABASE_URL: databaseUrl };

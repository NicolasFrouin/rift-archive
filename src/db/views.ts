import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Applies the Metabase-facing SQL views. Idempotent (CREATE OR REPLACE VIEW),
 * so it's safe to run on every worker boot — lets the views evolve without any
 * schema migration or re-fetch.
 */
export async function applyViews(): Promise<void> {
  const sql = await readFile(join(here, 'views.sql'), 'utf8');
  await pool.query(sql);
}

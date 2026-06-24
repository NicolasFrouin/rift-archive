import PgBoss from 'pg-boss';
import { env } from '../env.js';

/**
 * Queue names. pg-boss manages its own `pgboss` schema in the same Postgres
 * database, fully independent of the Drizzle-owned tables.
 */
export const QUEUES = {
  storeMatch: 'store-match',
  backfillPlayer: 'backfill-player',
  fetchIncremental: 'fetch-incremental',
} as const;

export type StoreMatchData = { matchId: string; puuid: string };
export type BackfillPlayerData = { playerId: number; puuid: string };
export type FetchIncrementalData = Record<string, never>;

let boss: PgBoss | undefined;

/** Lazily-constructed singleton pg-boss instance (started by the caller). */
export function getBoss(): PgBoss {
  if (!boss) {
    boss = new PgBoss(env.DATABASE_URL);
    boss.on('error', (err) => console.error('[pg-boss] error:', err));
  }
  return boss;
}

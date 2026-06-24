import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { listMatchIds } from '../riot/client.js';
import { getBoss, QUEUES, type BackfillPlayerData } from './boss.js';

const PAGE_SIZE = 100;

/**
 * One-time historical backfill for a newly added player: pages the full match-id
 * history (~2 years, Riot's retention limit) and enqueues a store-match job per
 * id. Idempotent — store-match dedups, so re-running just re-confirms.
 * Flips `backfill_done` so the player folds into incremental fetching afterwards.
 */
export async function backfillPlayer({ playerId, puuid }: BackfillPlayerData): Promise<void> {
  const boss = getBoss();
  let start = 0;
  let total = 0;

  for (;;) {
    const ids = await listMatchIds(puuid, { start, count: PAGE_SIZE });
    if (ids.length === 0) break;

    for (const matchId of ids) {
      await boss.send(QUEUES.storeMatch, { matchId, puuid });
    }
    total += ids.length;
    start += ids.length;

    if (ids.length < PAGE_SIZE) break; // last (partial) page reached
  }

  await db.update(players).set({ backfillDone: true }).where(eq(players.id, playerId));
  console.log(`[backfill] player ${playerId}: enqueued ${total} matches`);
}

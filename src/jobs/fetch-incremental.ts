import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { listMatchIds } from '../riot/client.js';
import { getBoss, QUEUES } from './boss.js';

const PAGE_SIZE = 100;

/**
 * Scheduled every 6 hours. Reads the live "active players" set each run, so a
 * player added between runs is picked up automatically. For each player:
 *  - not yet backfilled  -> enqueue the one-time historical backfill;
 *  - already backfilled   -> page match ids since `last_fetched_at` and enqueue
 *    a store-match per id, then advance the watermark.
 */
export async function fetchIncremental(): Promise<void> {
  const boss = getBoss();
  const active = await db.select().from(players).where(eq(players.active, true));
  console.log(`[incremental] ${active.length} active player(s)`);

  for (const player of active) {
    if (!player.backfillDone) {
      await boss.send(QUEUES.backfillPlayer, { playerId: player.id, puuid: player.puuid });
      continue;
    }

    // Epoch seconds; undefined on first incremental run -> Riot returns recent history.
    const startTime = player.lastFetchedAt
      ? Math.floor(player.lastFetchedAt.getTime() / 1000)
      : undefined;

    let start = 0;
    let total = 0;
    for (;;) {
      const ids = await listMatchIds(player.puuid, { start, count: PAGE_SIZE, startTime });
      if (ids.length === 0) break;
      for (const matchId of ids) {
        await boss.send(QUEUES.storeMatch, { matchId, puuid: player.puuid });
      }
      total += ids.length;
      start += ids.length;
      if (ids.length < PAGE_SIZE) break;
    }

    await db.update(players).set({ lastFetchedAt: new Date() }).where(eq(players.id, player.id));
    if (total > 0) console.log(`[incremental] player ${player.id}: enqueued ${total} new match(es)`);
  }
}

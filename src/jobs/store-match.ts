import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { matches, playerMatches } from '../db/schema.js';
import { getMatch } from '../riot/client.js';
import type { StoreMatchData } from './boss.js';

/**
 * The idempotent archiver primitive shared by backfill and incremental fetch.
 * - Dedups by match_id: if the match is already archived, skips the API call.
 * - Always (re)asserts the player_matches link, so a match first seen via one
 *   monitored player still gets linked when a second monitored player surfaces it.
 * Never updates or deletes an existing match row.
 */
export async function storeMatch({ matchId, puuid }: StoreMatchData): Promise<void> {
  const already = await db
    .select({ matchId: matches.matchId })
    .from(matches)
    .where(sql`${matches.matchId} = ${matchId}`)
    .limit(1);

  if (already.length === 0) {
    const raw = await getMatch(matchId);
    await db
      .insert(matches)
      .values({
        matchId,
        raw,
        gameCreation: raw.info?.gameCreation ? new Date(raw.info.gameCreation) : null,
        queueId: raw.info?.queueId ?? null,
        gameVersion: raw.info?.gameVersion ?? null,
      })
      .onConflictDoNothing();
  }

  await db.insert(playerMatches).values({ puuid, matchId }).onConflictDoNothing();
}

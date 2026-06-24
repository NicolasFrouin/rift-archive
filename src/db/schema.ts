import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import type { MatchDto } from '../riot/types.js';

/**
 * Monitored players. The scheduler reads `active = true` each run, so adding a
 * player later is just an INSERT — picked up on the next cycle. PUUID is the
 * stable identity, resolved once from a Riot ID (Name#TAG) via account-v1.
 */
export const players = pgTable('players', {
  id: serial('id').primaryKey(),
  gameName: text('game_name').notNull(), // Riot ID name (before '#')
  tagLine: text('tag_line').notNull(), // Riot ID tag (after '#')
  puuid: text('puuid').notNull().unique(),
  platform: text('platform').notNull(), // euw1 / eun1 (for summoner/league later)
  active: boolean('active').notNull().default(true),
  backfillDone: boolean('backfill_done').notNull().default(false),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }), // incremental watermark
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The archive. One row per match, ever. Never updated, never deleted.
 * `raw` is the untouched match-v5 payload; the other columns are extracted
 * copies kept only for cheap indexing/filtering.
 */
export const matches = pgTable(
  'matches',
  {
    matchId: text('match_id').primaryKey(), // e.g. EUW1_1234567890 — natural dedup key
    raw: jsonb('raw').$type<MatchDto>().notNull(),
    gameCreation: timestamp('game_creation', { withTimezone: true }),
    queueId: integer('queue_id'),
    gameVersion: text('game_version'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('matches_game_creation_idx').on(t.gameCreation),
    index('matches_queue_id_idx').on(t.queueId),
  ],
);

/**
 * Link table: a single match can contain several monitored players, so we map
 * each monitored puuid to the matches it appears in for trivial Metabase joins.
 */
export const playerMatches = pgTable(
  'player_matches',
  {
    puuid: text('puuid').notNull(),
    matchId: text('match_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.puuid, t.matchId] }),
    index('player_matches_match_id_idx').on(t.matchId),
  ],
);

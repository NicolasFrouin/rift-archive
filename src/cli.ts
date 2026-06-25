import { eq } from 'drizzle-orm';
import { db, pool } from './db/index.js';
import { players } from './db/schema.js';
import { resolvePuuid } from './riot/client.js';
import { getBoss, QUEUES } from './jobs/boss.js';
import { env } from './env.js';
import { syncMetabaseDashboards } from './metabase/sync.js';

/**
 * Small operational CLI (raw-SQL floor via Drizzle). Run inside the worker
 * container, e.g.:
 *   docker compose run --rm worker pnpm cli add-player "Faker#KR1" --platform euw1
 *   docker compose run --rm worker pnpm cli list-players
 *   docker compose run --rm worker pnpm cli deactivate-player "Faker#KR1"
 */

function parseRiotId(input: string): { gameName: string; tagLine: string } {
  const hash = input.lastIndexOf('#');
  if (hash <= 0 || hash === input.length - 1) {
    throw new Error(`Invalid Riot ID "${input}" — expected "Name#TAG"`);
  }
  return { gameName: input.slice(0, hash).trim(), tagLine: input.slice(hash + 1).trim() };
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function addPlayer(args: string[]): Promise<void> {
  const riotId = args[0];
  if (!riotId) throw new Error('Usage: add-player "Name#TAG" [--platform euw1]');
  const { gameName, tagLine } = parseRiotId(riotId);
  const platform = getFlag(args.slice(1), 'platform') ?? env.DEFAULT_PLATFORM;

  console.log(`Resolving PUUID for ${gameName}#${tagLine}…`);
  const puuid = await resolvePuuid(gameName, tagLine);

  const [row] = await db
    .insert(players)
    .values({ gameName, tagLine, puuid, platform })
    .onConflictDoUpdate({
      target: players.puuid,
      set: { gameName, tagLine, platform, active: true },
    })
    .returning();

  console.log(`Saved player #${row!.id} (${gameName}#${tagLine}) puuid=${puuid} platform=${platform}`);

  if (!row!.backfillDone) {
    const boss = getBoss();
    await boss.start();
    await boss.createQueue(QUEUES.backfillPlayer);
    await boss.send(QUEUES.backfillPlayer, { playerId: row!.id, puuid });
    await boss.stop({ graceful: true });
    console.log('Enqueued one-time historical backfill.');
  }
}

async function listPlayers(): Promise<void> {
  const rows = await db.select().from(players).orderBy(players.id);
  if (rows.length === 0) {
    console.log('No players yet. Add one with: add-player "Name#TAG"');
    return;
  }
  console.table(
    rows.map((p) => ({
      id: p.id,
      riotId: `${p.gameName}#${p.tagLine}`,
      platform: p.platform,
      active: p.active,
      backfilled: p.backfillDone,
      lastFetched: p.lastFetchedAt?.toISOString() ?? '—',
    })),
  );
}

async function deactivatePlayer(args: string[]): Promise<void> {
  const riotId = args[0];
  if (!riotId) throw new Error('Usage: deactivate-player "Name#TAG"');
  const { gameName, tagLine } = parseRiotId(riotId);
  const updated = await db
    .update(players)
    .set({ active: false })
    .where(eq(players.gameName, gameName))
    .returning();
  const match = updated.find((p) => p.tagLine === tagLine);
  if (!match) {
    console.log(`No active player matched ${gameName}#${tagLine}.`);
    return;
  }
  console.log(`Deactivated #${match.id} (${gameName}#${tagLine}). Archive is kept; fetching stops.`);
}

async function metabaseSync(args: string[]): Promise<void> {
  const url = getFlag(args, 'url');
  const username = getFlag(args, 'username');
  const password = getFlag(args, 'password');
  const databaseName = getFlag(args, 'database');

  await syncMetabaseDashboards({
    url,
    username,
    password,
    databaseName,
  });

  console.log('Metabase dashboards synced from metabase/cards and metabase/dashboards.');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'add-player':
      await addPlayer(args);
      break;
    case 'list-players':
      await listPlayers();
      break;
    case 'deactivate-player':
      await deactivatePlayer(args);
      break;
    case 'metabase-sync':
      await metabaseSync(args);
      break;
    default:
      console.log(
        'Commands: add-player "Name#TAG" [--platform euw1] | list-players | deactivate-player "Name#TAG" | metabase-sync [--url http://localhost:3000] [--username user@host] [--password *****] [--database lol]',
      );
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

import { resolvePuuid, listMatchIds, getMatch } from '../src/riot/client.js';

/**
 * Dev-only live smoke test (no database). Verifies twisted + the key + region
 * routing end-to-end:
 *   pnpm tsx scripts/smoke.ts "Name#TAG"
 */
async function main() {
  const riotId = process.argv[2];
  if (!riotId || !riotId.includes('#')) {
    console.error('Usage: pnpm tsx scripts/smoke.ts "Name#TAG"');
    process.exit(1);
  }
  const hash = riotId.lastIndexOf('#');
  const gameName = riotId.slice(0, hash);
  const tagLine = riotId.slice(hash + 1);

  console.log(`Resolving ${gameName}#${tagLine}…`);
  const puuid = await resolvePuuid(gameName, tagLine);
  console.log('PUUID:', puuid);

  const ids = await listMatchIds(puuid, { count: 3 });
  console.log(`Latest ${ids.length} match id(s):`, ids);

  if (ids[0]) {
    const m = await getMatch(ids[0]);
    console.log('Sample match:', {
      matchId: m.metadata?.matchId,
      queueId: m.info?.queueId,
      gameVersion: m.info?.gameVersion,
      participants: m.info?.participants?.length,
    });
  }
  console.log('\n✅ Riot client works end-to-end.');
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err?.message ?? err);
  process.exit(1);
});

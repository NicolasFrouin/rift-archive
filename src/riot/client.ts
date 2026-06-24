import { LolApi, RiotApi, Constants } from 'twisted';
import { env } from '../env.js';
import type { MatchDto } from './types.js';

/**
 * twisted clients. Both share the personal key and enable built-in 429 handling
 * (twisted reads the rate-limit headers and reattempts automatically), so the
 * jobs above never have to think about rate limits.
 */
const apiParams = {
  key: env.RIOT_API_KEY,
  rateLimitRetry: true,
  rateLimitRetryAttempts: 3,
  // Keep a small ceiling on concurrent calls to stay friendly to the personal key.
  concurrency: 5,
};

const lolApi = new LolApi(apiParams);
const riotApi = new RiotApi(apiParams);

/** Match routing region group (France -> EUROPE). Index the enum object by the
 * validated env key to get a proper RegionGroups enum value. */
const regionGroup = Constants.RegionGroups[env.REGION_GROUP];

/** Resolve a Riot ID (Name#TAG) to a stable PUUID. Done once per player. */
export async function resolvePuuid(gameName: string, tagLine: string): Promise<string> {
  const res = await riotApi.Account.getByRiotId(gameName, tagLine, regionGroup);
  return res.response.puuid;
}

/**
 * List match ids for a player, newest first. `start` pages through history;
 * `startTime` (epoch seconds) bounds incremental fetches to "since last run".
 */
export async function listMatchIds(
  puuid: string,
  opts: { count?: number; start?: number; startTime?: number } = {},
): Promise<string[]> {
  const res = await lolApi.MatchV5.list(puuid, regionGroup, {
    count: opts.count ?? 100,
    start: opts.start ?? 0,
    ...(opts.startTime !== undefined ? { startTime: opts.startTime } : {}),
  });
  return res.response;
}

/** Fetch one full match payload. */
export async function getMatch(matchId: string): Promise<MatchDto> {
  const res = await lolApi.MatchV5.get(matchId, regionGroup);
  return res.response;
}

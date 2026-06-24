import type { LolApi } from 'twisted';

/**
 * The match-v5 payload type. twisted bundles its DTOs without exporting them as
 * types, so we derive the shape from the API method's return type. This module
 * is type-only (no runtime imports), so importing it never pulls in env/clients
 * — safe for drizzle-kit to load via schema.ts at migration time.
 */
export type MatchDto = Awaited<ReturnType<LolApi['MatchV5']['get']>>['response'];

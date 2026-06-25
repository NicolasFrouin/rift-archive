import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const playersDir = join(root, 'metabase', 'players');

export type PlayerIdentity = {
  puuid: string;
  gameName: string;
  tagLine: string;
};

type CardSpec = {
  key: string;
  name: string;
  description: string;
  display: string;
  sql: string;
};

type DashboardCardSpec = {
  cardKey: string;
  row: number;
  col: number;
  sizeX: number;
  sizeY: number;
};

export function playerSlug(player: PlayerIdentity): string {
  const slug = `${player.gameName}-${player.tagLine}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || player.puuid.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function riotId(player: PlayerIdentity): string {
  return `${player.gameName}#${player.tagLine}`;
}

const ROOT_COLLECTION = 'Rift Archive';

function playerCollection(player: PlayerIdentity): string[] {
  return [ROOT_COLLECTION, 'Players', riotId(player)];
}

// puuids from Riot are URL-safe (letters, digits, '-', '_'). Guard before
// embedding into generated SQL so a generated file can never carry an injection.
function assertSafePuuid(puuid: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(puuid)) {
    throw new Error(`Refusing to generate analytics: unsafe puuid "${puuid}".`);
  }
}

function buildCards(player: PlayerIdentity): CardSpec[] {
  const id = riotId(player);
  const p = player.puuid;
  const scope = `WHERE puuid = '${p}'`;
  const scopeTimed = `WHERE puuid = '${p}' AND game_duration_seconds > 0`;

  return [
    {
      key: 'kpi-games',
      name: `${id} — Games`,
      description: `Total archived games for ${id}.`,
      display: 'scalar',
      sql: `SELECT count(*) AS games\nFROM v_player_match_stats\n${scope};\n`,
    },
    {
      key: 'kpi-winrate',
      name: `${id} — Winrate`,
      description: `Overall winrate for ${id}.`,
      display: 'scalar',
      sql: `SELECT round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct\nFROM v_player_match_stats\n${scope};\n`,
    },
    {
      key: 'kpi-kda',
      name: `${id} — KDA`,
      description: `Average KDA for ${id}.`,
      display: 'scalar',
      sql: `SELECT round(avg((kills + assists)::numeric / NULLIF(deaths, 0)), 2) AS kda\nFROM v_player_match_stats\n${scope};\n`,
    },
    {
      key: 'kpi-cs-per-min',
      name: `${id} — CS/min`,
      description: `Average creep score per minute for ${id}.`,
      display: 'scalar',
      sql: `SELECT round(avg(cs::numeric / NULLIF(game_duration_seconds, 0) * 60), 2) AS cs_per_min\nFROM v_player_match_stats\n${scopeTimed};\n`,
    },
    {
      key: 'weekly-trend',
      name: `${id} — Weekly Games and Winrate`,
      description: `Games and winrate over the last 26 weeks for ${id}.`,
      display: 'line',
      sql: `WITH weekly AS (
  SELECT
    date_trunc('week', game_creation)::date AS week_start,
    count(*)                                AS games,
    round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
    row_number() OVER (ORDER BY date_trunc('week', game_creation)::date DESC) AS week_rank
  FROM v_player_match_stats
  ${scope}
  GROUP BY 1
)
SELECT week_start, games, winrate_pct
FROM weekly
WHERE week_rank <= 26
ORDER BY week_start;\n`,
    },
    {
      key: 'kda-trend',
      name: `${id} — Weekly KDA Trend`,
      description: `Average KDA over the last 26 weeks for ${id}.`,
      display: 'line',
      sql: `WITH weekly AS (
  SELECT
    date_trunc('week', game_creation)::date AS week_start,
    round(avg((kills + assists)::numeric / NULLIF(deaths, 0)), 2) AS avg_kda,
    row_number() OVER (ORDER BY date_trunc('week', game_creation)::date DESC) AS week_rank
  FROM v_player_match_stats
  ${scope}
  GROUP BY 1
)
SELECT week_start, avg_kda
FROM weekly
WHERE week_rank <= 26
ORDER BY week_start;\n`,
    },
    {
      key: 'champions',
      name: `${id} — Champion Performance`,
      description: `Per-champion games, winrate, and KDA for ${id}.`,
      display: 'table',
      sql: `SELECT
  champion,
  count(*)                          AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
  round(avg((kills + assists)::numeric / NULLIF(deaths, 0)), 2) AS kda
FROM v_player_match_stats
${scope} AND champion IS NOT NULL AND champion <> ''
GROUP BY 1
ORDER BY games DESC;\n`,
    },
    {
      key: 'position-performance',
      name: `${id} — Role Performance`,
      description: `Games and winrate by role for ${id}.`,
      display: 'bar',
      sql: `SELECT
  position,
  count(*)                          AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct
FROM v_player_match_stats
${scope} AND position IS NOT NULL AND position <> ''
GROUP BY 1
ORDER BY games DESC;\n`,
    },
    {
      key: 'queue-breakdown',
      name: `${id} — Queue Breakdown`,
      description: `Games and winrate by queue for ${id}.`,
      display: 'bar',
      sql: `SELECT
  queue_id,
  count(*)                          AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct
FROM v_player_match_stats
${scope}
GROUP BY 1
ORDER BY games DESC;\n`,
    },
    {
      key: 'vision-by-position',
      name: `${id} — Vision by Role`,
      description: `Average vision score by role for ${id}.`,
      display: 'bar',
      sql: `SELECT
  position,
  count(*)                          AS games,
  round(avg(vision_score::numeric), 2) AS avg_vision
FROM v_player_match_stats
${scope} AND position IS NOT NULL AND position <> ''
GROUP BY 1
ORDER BY games DESC;\n`,
    },
    {
      key: 'duration-winrate',
      name: `${id} — Winrate by Game Length`,
      description: `Winrate bucketed by game duration for ${id}.`,
      display: 'bar',
      sql: `SELECT
  CASE
    WHEN game_duration_seconds < 1200 THEN '0-20 min'
    WHEN game_duration_seconds < 1800 THEN '20-30 min'
    WHEN game_duration_seconds < 2400 THEN '30-40 min'
    ELSE '40+ min'
  END                               AS duration_bucket,
  count(*)                          AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct
FROM v_player_match_stats
${scopeTimed}
GROUP BY 1
ORDER BY duration_bucket;\n`,
    },
    {
      key: 'recent-matches',
      name: `${id} — Recent Matches`,
      description: `Last 30 archived games for ${id}.`,
      display: 'table',
      sql: `SELECT
  game_creation,
  champion,
  position,
  queue_id,
  win,
  kills,
  deaths,
  assists,
  cs,
  gold_earned,
  damage_to_champions,
  vision_score,
  round(game_duration_seconds / 60.0, 1) AS duration_min
FROM v_player_match_stats
${scope}
ORDER BY game_creation DESC
LIMIT 30;\n`,
    },
  ];
}

const layout: DashboardCardSpec[] = [
  { cardKey: 'kpi-games', row: 0, col: 0, sizeX: 6, sizeY: 3 },
  { cardKey: 'kpi-winrate', row: 0, col: 6, sizeX: 6, sizeY: 3 },
  { cardKey: 'kpi-kda', row: 0, col: 12, sizeX: 6, sizeY: 3 },
  { cardKey: 'kpi-cs-per-min', row: 0, col: 18, sizeX: 6, sizeY: 3 },
  { cardKey: 'weekly-trend', row: 3, col: 0, sizeX: 12, sizeY: 7 },
  { cardKey: 'kda-trend', row: 3, col: 12, sizeX: 12, sizeY: 7 },
  { cardKey: 'champions', row: 10, col: 0, sizeX: 24, sizeY: 8 },
  { cardKey: 'position-performance', row: 18, col: 0, sizeX: 8, sizeY: 7 },
  { cardKey: 'queue-breakdown', row: 18, col: 8, sizeX: 8, sizeY: 7 },
  { cardKey: 'vision-by-position', row: 18, col: 16, sizeX: 8, sizeY: 7 },
  { cardKey: 'duration-winrate', row: 25, col: 0, sizeX: 24, sizeY: 6 },
  { cardKey: 'recent-matches', row: 31, col: 0, sizeX: 24, sizeY: 9 },
];

// Stable Metabase identity is keyed on puuid so renaming a player updates the
// same cards/dashboard instead of creating duplicates.
function cardMarkerId(player: PlayerIdentity, cardKey: string): string {
  return `player-${player.puuid}-${cardKey}`;
}

export async function generatePlayerAnalyticsFiles(player: PlayerIdentity): Promise<string> {
  assertSafePuuid(player.puuid);

  const slug = playerSlug(player);
  const playerDir = join(playersDir, slug);
  const cardsDir = join(playerDir, 'cards');

  await rm(playerDir, { recursive: true, force: true });
  await mkdir(cardsDir, { recursive: true });

  const cards = buildCards(player);

  await Promise.all(
    cards.map(async (card, index) => {
      const prefix = String(index + 1).padStart(2, '0');
      const base = `${prefix}-${card.key}`;
      const meta = {
        id: cardMarkerId(player, card.key),
        name: card.name,
        description: card.description,
        display: card.display,
        queryFile: `${base}.sql`,
        collection: playerCollection(player),
      };
      await writeFile(join(cardsDir, `${base}.json`), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
      await writeFile(join(cardsDir, `${base}.sql`), card.sql, 'utf8');
    }),
  );

  const dashboard = {
    id: `player-${player.puuid}-analytics`,
    name: `${riotId(player)} — Analytics`,
    description: `In-depth analytics scoped to ${riotId(player)}.`,
    collection: playerCollection(player),
    cards: layout.map((entry) => ({
      cardId: cardMarkerId(player, entry.cardKey),
      row: entry.row,
      col: entry.col,
      sizeX: entry.sizeX,
      sizeY: entry.sizeY,
    })),
  };

  await writeFile(
    join(playerDir, 'dashboard.json'),
    `${JSON.stringify(dashboard, null, 2)}\n`,
    'utf8',
  );

  return playerDir;
}

const sharedCardsDir = join(root, 'metabase', 'cards');
const sharedDashboardsDir = join(root, 'metabase', 'dashboards');

type SharedCard = {
  base: string;
  id: string;
  name: string;
  description: string;
  display: string;
  sql: string;
};

const sharedCards: SharedCard[] = [
  {
    base: '001-weekly-trend',
    id: 'weekly-trend',
    name: 'Weekly Games and Winrate',
    description: 'Games and winrate trend over the last 26 weeks, per player.',
    display: 'line',
    sql: `WITH weekly AS (
  SELECT
    concat(game_name, '#', tag_line) AS player,
    date_trunc('week', game_creation)::date AS week_start,
    count(*) AS games,
    round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
    row_number() OVER (
      PARTITION BY concat(game_name, '#', tag_line)
      ORDER BY date_trunc('week', game_creation)::date DESC
    ) AS week_rank
  FROM v_player_match_stats
  GROUP BY 1, 2
)
SELECT
  player,
  week_start,
  games,
  winrate_pct
FROM weekly
WHERE week_rank <= 26
ORDER BY player, week_start DESC;\n`,
  },
  {
    base: '002-player-summary',
    id: 'player-summary',
    name: 'Player Summary',
    description: 'Per monitored player summary metrics.',
    display: 'table',
    sql: `SELECT
  concat(game_name, '#', tag_line) AS player,
  count(*) AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
  round(avg(kills::numeric), 2) AS avg_kills,
  round(avg(deaths::numeric), 2) AS avg_deaths,
  round(avg(assists::numeric), 2) AS avg_assists,
  round(avg((kills + assists)::numeric / NULLIF(deaths, 0)), 2) AS avg_kda
FROM v_player_match_stats
GROUP BY 1
ORDER BY games DESC;\n`,
  },
  {
    base: '006-kpi-total-matches',
    id: 'kpi-total-matches',
    name: 'Matches Archived',
    description: 'Distinct matches stored across all monitored players.',
    display: 'scalar',
    sql: `SELECT count(DISTINCT match_id) AS matches\nFROM v_player_match_stats;\n`,
  },
  {
    base: '007-kpi-total-games',
    id: 'kpi-total-games',
    name: 'Tracked Participations',
    description: 'Total games played by monitored players (one per player per match).',
    display: 'scalar',
    sql: `SELECT count(*) AS games\nFROM v_player_match_stats;\n`,
  },
  {
    base: '008-kpi-tracked-players',
    id: 'kpi-tracked-players',
    name: 'Tracked Players',
    description: 'Distinct monitored players with at least one archived match.',
    display: 'scalar',
    sql: `SELECT count(DISTINCT concat(game_name, '#', tag_line)) AS players\nFROM v_player_match_stats;\n`,
  },
];

const overviewDashboard = {
  id: 'overview',
  name: 'Rift Archive Overview',
  description:
    'Archive-wide totals and a cross-player leaderboard. Per-player deep dives live in their own dashboards.',
  collection: [ROOT_COLLECTION],
  cards: [
    { cardId: 'kpi-total-matches', row: 0, col: 0, sizeX: 8, sizeY: 3 },
    { cardId: 'kpi-total-games', row: 0, col: 8, sizeX: 8, sizeY: 3 },
    { cardId: 'kpi-tracked-players', row: 0, col: 16, sizeX: 8, sizeY: 3 },
    { cardId: 'weekly-trend', row: 3, col: 0, sizeX: 24, sizeY: 7 },
    { cardId: 'player-summary', row: 10, col: 0, sizeX: 24, sizeY: 9 },
  ],
};

export async function generateSharedAnalyticsFiles(): Promise<void> {
  await rm(sharedCardsDir, { recursive: true, force: true });
  await mkdir(sharedCardsDir, { recursive: true });
  await mkdir(sharedDashboardsDir, { recursive: true });

  await Promise.all(
    sharedCards.map(async (card) => {
      const meta = {
        id: card.id,
        name: card.name,
        description: card.description,
        display: card.display,
        queryFile: `${card.base}.sql`,
        collection: [ROOT_COLLECTION],
      };
      await writeFile(
        join(sharedCardsDir, `${card.base}.json`),
        `${JSON.stringify(meta, null, 2)}\n`,
        'utf8',
      );
      await writeFile(join(sharedCardsDir, `${card.base}.sql`), card.sql, 'utf8');
    }),
  );

  await writeFile(
    join(sharedDashboardsDir, '001-overview.json'),
    `${JSON.stringify(overviewDashboard, null, 2)}\n`,
    'utf8',
  );
}

// Regenerate the entire metabase/ tree from code + the current player list, so
// the files are a build artifact that can be recreated on every deploy.
export async function generateAllAnalyticsFiles(players: PlayerIdentity[]): Promise<void> {
  await generateSharedAnalyticsFiles();
  await rm(playersDir, { recursive: true, force: true });
  for (const player of players) {
    await generatePlayerAnalyticsFiles(player);
  }
}

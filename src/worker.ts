import type PgBoss from 'pg-boss';
import { writeFile } from 'node:fs/promises';
import { runMigrations } from './db/migrate.js';
import { applyViews } from './db/views.js';
import { pool } from './db/index.js';
import {
  getBoss,
  QUEUES,
  type StoreMatchData,
  type BackfillPlayerData,
} from './jobs/boss.js';
import { storeMatch } from './jobs/store-match.js';
import { backfillPlayer } from './jobs/backfill-player.js';
import { fetchIncremental } from './jobs/fetch-incremental.js';
import { syncMetabaseDashboards } from './metabase/sync.js';

// Runs the incremental sweep every 6 hours (UTC inside the container).
const INCREMENTAL_CRON = '0 */6 * * *';

// Liveness heartbeat: the worker writes a timestamp here every interval, but
// only after a successful DB ping — so a fresh file means "loop alive AND
// Postgres reachable". The Docker healthcheck reads it (see scripts/healthcheck.mjs).
const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE ?? '/tmp/rift-worker-heartbeat';
const HEARTBEAT_INTERVAL_MS = 60_000;
const WORKER_MB_SYNC_ON_STARTUP = (process.env.WORKER_MB_SYNC_ON_STARTUP ?? 'false') === 'true';
const WORKER_MB_SYNC_ATTEMPTS = Math.max(1, Number(process.env.WORKER_MB_SYNC_ATTEMPTS ?? '8'));
const WORKER_MB_SYNC_RETRY_DELAY_MS = Math.max(
  250,
  Number(process.env.WORKER_MB_SYNC_RETRY_DELAY_MS ?? '5000'),
);
const WORKER_MB_SYNC_INITIAL_DELAY_MS = Math.max(
  0,
  Number(process.env.WORKER_MB_SYNC_INITIAL_DELAY_MS ?? '30000'),
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function syncDashboardsOnStartup(): void {
  if (!WORKER_MB_SYNC_ON_STARTUP) return;

  void (async () => {
    if (WORKER_MB_SYNC_INITIAL_DELAY_MS > 0) {
      console.log(
        `[worker] metabase startup sync will start in ${WORKER_MB_SYNC_INITIAL_DELAY_MS}ms (service warm-up delay)`,
      );
      await sleep(WORKER_MB_SYNC_INITIAL_DELAY_MS);
    }

    for (let attempt = 1; attempt <= WORKER_MB_SYNC_ATTEMPTS; attempt += 1) {
      try {
        console.log(`[worker] syncing metabase dashboards (attempt ${attempt}/${WORKER_MB_SYNC_ATTEMPTS})…`);
        await syncMetabaseDashboards();
        console.log('[worker] metabase dashboard sync done');
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === WORKER_MB_SYNC_ATTEMPTS) {
          console.error(`[worker] metabase dashboard sync failed after ${attempt} attempts: ${message}`);
          return;
        }
        console.warn(`[worker] metabase sync attempt ${attempt} failed: ${message}`);
        await sleep(WORKER_MB_SYNC_RETRY_DELAY_MS);
      }
    }
  })();
}

async function beat(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    await writeFile(HEARTBEAT_FILE, String(Date.now()));
  } catch (err) {
    // Skip the write on a DB blip; the file goes stale -> healthcheck fails.
    console.error('[worker] heartbeat skipped:', err instanceof Error ? err.message : err);
  }
}

function startHeartbeat(): void {
  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  timer.unref(); // don't keep the process alive on its own account
}

async function main(): Promise<void> {
  console.log('[worker] applying migrations…');
  await runMigrations();

  console.log('[worker] applying views…');
  await applyViews();

  syncDashboardsOnStartup();

  const boss = getBoss();
  await boss.start();
  console.log('[worker] pg-boss started');

  // Queues must exist before send/work in pg-boss v10.
  await boss.createQueue(QUEUES.storeMatch);
  await boss.createQueue(QUEUES.backfillPlayer);
  await boss.createQueue(QUEUES.fetchIncremental);

  // store-match: high throughput, small batches keep API pressure gentle.
  await boss.work<StoreMatchData>(
    QUEUES.storeMatch,
    { batchSize: 2 },
    async (jobs: PgBoss.Job<StoreMatchData>[]) => {
      for (const job of jobs) await storeMatch(job.data);
    },
  );

  // backfill-player: one heavy job per new player; process singly.
  await boss.work<BackfillPlayerData>(
    QUEUES.backfillPlayer,
    { batchSize: 1 },
    async (jobs: PgBoss.Job<BackfillPlayerData>[]) => {
      for (const job of jobs) await backfillPlayer(job.data);
    },
  );

  // fetch-incremental: the scheduled coordinator.
  await boss.work(
    QUEUES.fetchIncremental,
    { batchSize: 1 },
    async () => {
      await fetchIncremental();
    },
  );

  // Persisted schedule (pg-boss stores it; re-registering just upserts).
  await boss.schedule(QUEUES.fetchIncremental, INCREMENTAL_CRON);
  console.log(`[worker] scheduled '${QUEUES.fetchIncremental}' (${INCREMENTAL_CRON})`);

  // Kick one sweep on boot so newly added players / pending backfills don't
  // wait up to 6h for the first scheduled run.
  await boss.send(QUEUES.fetchIncremental, {});

  startHeartbeat();
  console.log('[worker] ready');
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, shutting down…`);
  try {
    await getBoss().stop({ graceful: true });
    await pool.end();
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});

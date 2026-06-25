# rift-archive

Self-hosted **archiver for League of Legends match history**. It fetches every
match for a set of monitored players exactly once, stores the **untouched raw
match-v5 JSON** in Postgres forever (Riot only keeps ~2 years), and exposes the
data to Metabase for dashboards.

## Architecture

Three Docker services:

| service    | role                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `postgres` | source of truth. Two databases: `lol` (app + pg-boss) and `metabase` (Metabase's own metadata). |
| `worker`   | always-on core (Node/TS): twisted (Riot API) + pg-boss (jobs/schedule) + Drizzle (schema).      |
| `metabase` | dashboards, reads the `lol` database.                                                           |

- **twisted** talks to Riot and handles 429 retries / the PUUID flow.
- **pg-boss** owns its own `pgboss` schema in the `lol` database, independent of Drizzle.
- **Drizzle** owns `players`, `matches`, `player_matches` + the `v_player_match_stats` view.

A future web layer would just be another reader of the same Postgres.

## Data model

- `players` — the monitored set. The scheduler reads `active = true` each run, so
  adding a player is just an INSERT (via the CLI), picked up next cycle.
- `matches` — one row per match, ever (`match_id` PK, raw JSONB). Never updated, never deleted.
- `player_matches` — links each monitored puuid to the matches it appears in.
- `v_player_match_stats` — Metabase-facing view: one row per (player, match) with
  common stats flattened out of the raw JSON. Re-applied idempotently on boot, so
  analysis can evolve without re-fetching.

## Jobs

- `fetch-incremental` — scheduled **every 6 hours**. For each active player: enqueue
  a one-time backfill if not yet done, else fetch match ids since `last_fetched_at`.
- `backfill-player` — pages the full history (~2 years) for a newly added player.
- `store-match` — idempotent unit of work: dedup by `match_id`, store raw + link.

## Setup

1. Copy env and fill in your **personal** (non-expiring) Riot API key + a Postgres password:

   ```bash
   cp .env.example .env
   # edit .env: RIOT_API_KEY, POSTGRES_PASSWORD
   ```

   `POSTGRES_PASSWORD` is the only DB password — the worker/CLI build their
   connection string from it and Metabase reuses it (nothing to keep in sync).
2. Start the stack (dev — see [Deployment](#deployment) for prod):

   ```bash
   docker compose up -d --build
   ```

   The worker runs migrations, applies views, starts pg-boss, registers the 6h
   schedule, and kicks one sweep immediately.
3. Add players to monitor (resolves Riot ID → PUUID, then backfills history):

   ```bash
   docker compose run --rm worker pnpm cli add-player "Faker#KR1" --platform euw1
   docker compose run --rm worker pnpm cli list-players
   docker compose run --rm worker pnpm cli deactivate-player "Faker#KR1"
   ```

4. Open Metabase at <http://localhost:3000>, finish first-run setup, then add a
   **Postgres** data source pointing at host `postgres`, database `lol`. Build charts
   off `v_player_match_stats` (e.g. winrate by champion, games per week).

## Dashboards as files

You can keep Metabase dashboards in git and re-apply them at any time.

- Card definitions live in `metabase/cards/*.json`
- Card SQL lives in `metabase/cards/*.sql`
- Dashboard layouts live in `metabase/dashboards/*.json`

Seed/sync them to Metabase:

```bash
pnpm metabase:sync
```

By default, the sync reads worker-scoped vars (`WORKER_MB_URL`,
`WORKER_MB_USERNAME`, `WORKER_MB_PASSWORD`, `WORKER_MB_DATABASE_NAME`). In
Docker Compose, the default URL is the internal service DNS
(`http://metabase:3000`). `MB_*` and `METABASE_*` aliases are also supported
for backward compatibility. If you run the command from your host machine, use
`--url http://localhost:3000` (or set `WORKER_MB_URL`) instead.

The sync command upserts cards/dashboards (tracked with stable IDs in
descriptions) and rewrites dashboard layout from files, so git is your source of
truth.

To run the sync automatically when the worker starts:

```bash
WORKER_MB_SYNC_ON_STARTUP=true
```

Optional startup retry tuning:

- `WORKER_MB_SYNC_ATTEMPTS` (default `8`)
- `WORKER_MB_SYNC_RETRY_DELAY_MS` (default `5000`)
- `WORKER_MB_SYNC_INITIAL_DELAY_MS` (default `30000`)

Startup sync is best-effort: if Metabase is still booting or credentials are
missing, the worker logs the sync failure and continues processing archive jobs.

## Deployment

Compose is split so the same images run two ways:

| file                          | role                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `docker-compose.yml`          | base — prod-safe (Metabase on `127.0.0.1:3000`, Postgres not published)                      |
| `docker-compose.override.yml` | dev — auto-merged by `docker compose up`; exposes localhost Postgres, hot-reloads the worker |
| `docker-compose.prod.yml`     | prod extras — the offsite backup sidecar + the `autoheal` watchdog                           |

```bash
# Dev (auto-loads the override)
docker compose up -d --build

# Prod (explicit files — the dev override is NOT applied)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Metabase binds to `127.0.0.1` only. For remote access, put a reverse proxy with
TLS + auth (Caddy, nginx, Traefik) in front of port 3000 — don't expose it raw.

The prod file also runs **autoheal**: it watches the `postgres` and `worker`
containers (labelled `autoheal=true`) and restarts any whose Docker healthcheck
goes unhealthy. It mounts the Docker socket to issue those restarts, so only run
it on a host you trust.

## Offsite backups

The `backup` service (prod file) runs `pg_dump` of the `lol` archive nightly,
gzips it, uploads via **rclone**, and prunes copies older than
`BACKUP_RETENTION_DAYS`. It works with any rclone remote; for **Google Drive**
(user OAuth — uses your account's 15 GB):

1. On a machine with a browser (or WSL), get a token for your **personal** Google
   account and copy the JSON it prints:

   ```bash
   rclone authorize "drive"
   ```

2. Create `./rclone.conf` next to the compose files (gitignored). Set
   `root_folder_id` to the Drive folder you back up into — the last segment of
   `https://drive.google.com/drive/folders/<FOLDER_ID>`:

   ```ini
   [gdrive]
   type = drive
   scope = drive
   token = {…paste the JSON from step 1…}
   root_folder_id = <FOLDER_ID>
   ```

3. In `.env`: `RCLONE_REMOTE=gdrive  RCLONE_PATH=rift-archive-backups`. Re-run
   `rclone authorize "drive"` and replace `token` if it's ever revoked.

> **Service accounts do _not_ work with consumer Google accounts** — uploads fail
> with `storageQuotaExceeded` (an SA has no Drive storage of its own, and sharing
> a folder with it doesn't lend yours). They only work against a Google **Workspace
> Shared Drive**. Use the user-OAuth flow above on a free account.

### Test it

Start prod (above), then run a dump on demand:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backup /usr/local/bin/backup.sh
```

> Tip: any S3-compatible remote (Backblaze B2, etc.) is simpler than Drive
> (static key/secret, no OAuth) — just configure it as the rclone remote instead.

## Local development (without Docker)

Requires Node ≥ 20 and a reachable Postgres (`DATABASE_URL` in your shell/`.env`).

```bash
pnpm install
pnpm db:migrate     # apply migrations
pnpm worker         # run the worker
pnpm cli list-players
pnpm typecheck
pnpm db:generate    # regenerate migrations after a schema change
pnpm db:studio      # Drizzle Studio
```

## Notes

- Region: France → **EUROPE** match routing (`REGION_GROUP`), `euw1`/`eun1` platforms
  for per-player metadata.
- The personal key never expires; the dev key dies every 24h — don't use it here.
- Deferred by design: custom web UI, Grafana, Superset, Redis. pg-boss + Metabase
  cover the current need.

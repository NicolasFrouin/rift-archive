#!/bin/sh
# pg_dump the archive DB, gzip it, upload offsite via rclone, then prune old
# remote copies. Invoked by crond (see docker/backup.Dockerfile) and runnable
# on demand:  docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backup /usr/local/bin/backup.sh
set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_USER:=rift}"
: "${POSTGRES_DB:=lol}"
: "${RCLONE_REMOTE:=gdrive}"
: "${RCLONE_PATH:=rift-archive-backups}"
: "${BACKUP_RETENTION_DAYS:=30}"
RCLONE_CONF=/config/rclone/rclone.conf

stamp=$(date +%Y%m%d-%H%M%S)
file="/tmp/${POSTGRES_DB}-${stamp}.sql.gz"

# Fail fast on a broken/expired remote *before* spending time on a dump, so the
# log shows a clear auth error instead of a half-finished backup.
echo "[backup] checking remote ${RCLONE_REMOTE}:"
if ! rclone --config "${RCLONE_CONF}" lsd "${RCLONE_REMOTE}:" >/dev/null 2>&1; then
  echo "[backup] ERROR: cannot reach '${RCLONE_REMOTE}:' — check rclone.conf / token" >&2
  rclone --config "${RCLONE_CONF}" lsd "${RCLONE_REMOTE}:" >&2 || true
  exit 1
fi

echo "[backup] dumping ${POSTGRES_DB}@${POSTGRES_HOST} -> ${file}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h "${POSTGRES_HOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  | gzip > "${file}"

echo "[backup] uploading to ${RCLONE_REMOTE}:${RCLONE_PATH}"
rclone --config "${RCLONE_CONF}" copy "${file}" "${RCLONE_REMOTE}:${RCLONE_PATH}"
rm -f "${file}"

echo "[backup] pruning remote copies older than ${BACKUP_RETENTION_DAYS}d"
rclone --config "${RCLONE_CONF}" delete --min-age "${BACKUP_RETENTION_DAYS}d" "${RCLONE_REMOTE}:${RCLONE_PATH}"

echo "[backup] done ($(date))"

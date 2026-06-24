# Backup sidecar: pg_dump + rclone, scheduled with busybox crond.
FROM alpine:3.20

# postgresql16-client matches the postgres:16 server; rclone uploads offsite.
RUN apk add --no-cache postgresql16-client rclone tzdata

COPY docker/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# Write the crontab from the runtime BACKUP_CRON env (default 03:17 daily), then
# run cron in the foreground and tail the log so `docker compose logs backup` works.
CMD ["sh", "-c", "echo \"${BACKUP_CRON:-17 3 * * *} /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1\" > /etc/crontabs/root && touch /var/log/backup.log && crond -b -l 8 && tail -f /var/log/backup.log"]

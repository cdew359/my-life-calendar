#!/bin/sh
set -eu
umask 077
base=/opt/my-life/calendar-backups/shared-mysql-daily
mkdir -p "$base"
chmod 700 "$base"
stamp=$(date +%Y%m%d-%H%M%S)
cd /opt/my-life/calendar-cloud-trial/deploy
docker compose --env-file .env -f compose.yml exec -T mysql sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --default-character-set=utf8mb4 -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF calendar_cloud' > "$base/mysql-$stamp.sql.tmp"
test -s "$base/mysql-$stamp.sql.tmp"
mv "$base/mysql-$stamp.sql.tmp" "$base/mysql-$stamp.sql"
find "$base" -maxdepth 1 -type f -name 'mysql-*.sql' -mtime +14 -delete
printf 'SHARED_MYSQL_BACKUP_OK %s\n' "$stamp"

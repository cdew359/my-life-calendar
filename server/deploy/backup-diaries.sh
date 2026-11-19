#!/bin/sh
set -eu
umask 077
base=/opt/my-life/calendar-backups/diary-daily
mkdir -p "$base"
chmod 700 "$base"
stamp=$(date +%Y%m%d-%H%M%S)
docker exec zhaojian-postgres pg_dump -U calendar_diary -d calendar_diary -Fc > "$base/diary-$stamp.dump.tmp"
test -s "$base/diary-$stamp.dump.tmp"
mv "$base/diary-$stamp.dump.tmp" "$base/diary-$stamp.dump"
cp /opt/my-life/calendar/data/accounts.json "$base/accounts-$stamp.json"
find "$base" -maxdepth 1 -type f \( -name 'diary-*.dump' -o -name 'accounts-*.json' \) -mtime +14 -delete
printf 'DIARY_BACKUP_OK %s\n' "$stamp"

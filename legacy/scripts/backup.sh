#!/bin/sh
# Backup harian database + file unggahan. Pasang di crontab VPS:
#   15 2 * * * cd /opt/sk-crm && ./scripts/backup.sh >> /var/log/skcrm-backup.log 2>&1
set -eu
DIR=${BACKUP_DIR:-/opt/sk-crm-backups}
KEEP_DAYS=${KEEP_DAYS:-14}
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DIR"
docker compose exec -T db pg_dump -U skcrm -d skcrm --format=custom > "$DIR/db-$STAMP.dump"
docker compose run --rm --no-deps -v "$DIR:/backup" --entrypoint sh app -c "tar czf /backup/uploads-$STAMP.tgz -C /data uploads"
find "$DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date) backup selesai: $DIR/db-$STAMP.dump"

#!/bin/sh
# Pulihkan database dari file backup: ./scripts/restore.sh /opt/sk-crm-backups/db-20261007-0215.dump
set -eu
FILE=${1:?pakai: ./scripts/restore.sh <file.dump>}
echo "Database akan DITIMPA dengan $FILE. Ketik YA untuk lanjut:"
read -r ok
[ "$ok" = "YA" ] || exit 1
docker compose stop app
docker compose exec -T db pg_restore -U skcrm -d skcrm --clean --if-exists < "$FILE"
docker compose start app

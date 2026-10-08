#!/usr/bin/env bash
# Update server Node dari branch server-vps. Aman dijadwalkan di crontab:
# hanya install & restart bila ada commit baru.
# Pertama kali:  git clone -b server-vps git@github.com:antoniusfajar/crm-sonokembang.git /opt/SK-crm
set -e
cd "$(dirname "$(readlink -f "$0")")"
git fetch -q origin server-vps
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/server-vps)" ]; then
  exit 0
fi
git pull -q --ff-only origin server-vps
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs
pm2 save
echo "$(date '+%F %T') deploy $(git rev-parse --short HEAD)"

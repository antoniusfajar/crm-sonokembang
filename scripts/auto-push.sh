#!/usr/bin/env bash
# Versi Git Bash / Linux dari auto-push.ps1.  Pakai: bash scripts/auto-push.sh [detik]
cd "$(dirname "$0")/.."
INTERVAL="${1:-30}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Auto-push aktif -> origin/$BRANCH (tiap ${INTERVAL}s). Ctrl+C untuk berhenti."
while true; do
  if [ -n "$(git status --porcelain)" ]; then
    MSG="auto: $(git status --porcelain | wc -l | tr -d ' ') file berubah $(date '+%Y-%m-%d %H:%M:%S')"
    git add -A && git commit -qm "$MSG" && git pull -q --rebase origin "$BRANCH" && git push -q origin "$BRANCH" \
      && echo "[$(date +%T)] pushed: $MSG" || echo "[$(date +%T)] push GAGAL"
  fi
  sleep "$INTERVAL"
done

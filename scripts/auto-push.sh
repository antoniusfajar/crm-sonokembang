#!/usr/bin/env bash
# Versi Git Bash / Linux dari auto-push.ps1 (sinkron dua arah).  Pakai: bash scripts/auto-push.sh [detik]
cd "$(dirname "$0")/.."
INTERVAL="${1:-30}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
WHO="$(git config user.name)"
echo "Sinkron aktif ($WHO) <-> origin/$BRANCH tiap ${INTERVAL}s. Ctrl+C untuk berhenti."
while true; do
  if [ -n "$(git status --porcelain)" ]; then
    git add -A && git commit -qm "auto($WHO): $(git status --porcelain | wc -l | tr -d ' ') file $(date '+%F %T')"
  fi
  git fetch -q origin "$BRANCH"
  if [ "$(git rev-list --count HEAD..origin/$BRANCH)" -gt 0 ]; then
    if ! git pull -q --rebase origin "$BRANCH"; then
      echo "[$(date +%T)] KONFLIK - sinkron dihentikan. Minta Claude menyelesaikan, atau: git rebase --abort"
      exit 1
    fi
    echo "[$(date +%T)] ditarik perubahan dari GitHub"
  fi
  if [ "$(git rev-list --count origin/$BRANCH..HEAD)" -gt 0 ]; then
    git push -q origin "$BRANCH" && echo "[$(date +%T)] dikirim" || echo "[$(date +%T)] push GAGAL"
  fi
  sleep "$INTERVAL"
done

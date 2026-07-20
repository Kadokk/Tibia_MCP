#!/usr/bin/env bash
# TibiaEdge VPS deploy — invoked by GitHub Actions through a forced-command
# SSH key (authorized_keys pins this exact path), or manually on the box.
# Assumes: clone at /opt/tibiaedge/app with .env beside docker-compose.yml.
set -euo pipefail

APP_DIR=/opt/tibiaedge/app
cd "$APP_DIR"

[ -f .env ] || { echo "ERROR: $APP_DIR/.env missing — first-time setup incomplete"; exit 1; }

echo "== git update =="
git fetch origin main
git merge --ff-only origin/main
git log -1 --oneline

echo "== build =="
docker compose build

BOT_ID_BEFORE=$(docker compose ps -q bot 2>/dev/null || true)

echo "== up =="
docker compose up -d

BOT_ID_AFTER=$(docker compose ps -q bot)
if [ -n "$BOT_ID_BEFORE" ] && [ "$BOT_ID_BEFORE" = "$BOT_ID_AFTER" ]; then
  echo "bot container unchanged — no restart, skipping ready wait"
else
  echo "== waiting for bot ready =="
  ready=0
  for i in $(seq 1 45); do
    if docker compose logs bot --since 3m 2>/dev/null | grep -q "TibiaEdge Discord bot ready"; then
      echo "bot ready"; ready=1; break
    fi
    sleep 2
  done
  if [ "$ready" -ne 1 ]; then
    echo "ERROR: bot never logged ready"
    docker compose logs bot --since 3m | tail -30
    exit 1
  fi
fi

echo "== one-bot check (deploy.md 5b: one token, ONE bot) =="
BOTS=$(docker ps --format '{{.Names}}' | grep -c -- '-bot-' || true)
echo "bot containers on host: $BOTS (expect 1)"
[ "$BOTS" -eq 1 ]

docker compose ps
echo "DEPLOY OK"

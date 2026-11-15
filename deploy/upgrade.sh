#!/bin/sh
# Upgrade Egg on a server that runs it with Docker Compose.
#
#   sh deploy/upgrade.sh
#
# What it does, in order:
#   1. backs up the database (the same as: sh deploy/backup.sh). A failed backup stops the upgrade.
#   2. git pull, when this folder is a git checkout
#   3. docker compose build
#   4. docker compose up -d
# Database migrations run by themselves when the app starts, so there is no separate step.
# To go back: git checkout the old version, then run this again, and restore the backup
# (gunzip a file from backups/ over EGG_DATA_DIR/egg.db while the stack is stopped) if the
# new version already changed the database.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -f .env ]; then
  echo "No .env here. Copy deploy/.env.example to .env first." >&2
  exit 1
fi

echo "== Backup first (to run it by hand: sh deploy/backup.sh)"
# Inspect the running container: its effective environment and mount are the
# source of truth even when Compose interpolation or shell overrides are used.
container=$(docker compose ps -q app)
if [ -z "$container" ]; then
  echo "The app container must be running so its database can be identified and backed up." >&2
  exit 1
fi
db_url=$(docker compose exec -T app node -p 'process.env.DATABASE_URL || ""' | tr -d '\r')
data_mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container")
case "$db_url" in
  file:/data/*) container_db=${db_url#file:} ;;
  *) echo "Cannot automatically back up the configured DATABASE_URL; back it up separately before upgrading." >&2; exit 1 ;;
esac
case "$container_db" in
  *".."*|*"?"*|*"#"*) echo "Unsupported database path; back it up separately before upgrading." >&2; exit 1 ;;
esac
if [ -z "$data_mount" ]; then
  echo "Cannot identify the app's /data mount; refusing to upgrade without a backup." >&2
  exit 1
fi
EGG_SKIP_IF_MISSING=0 EGG_DB="$data_mount/${container_db#/data/}" EGG_CONTAINER_DB="$container_db" EGG_DATA_MOUNT="$data_mount" sh deploy/backup.sh

if [ -d .git ]; then
  echo "== git pull"
  git pull --ff-only
else
  echo "== Not a git checkout, skipping git pull. Put the new files here yourself."
fi

echo "== docker compose build"
docker compose build

echo "== docker compose up -d"
docker compose up -d --remove-orphans

echo "== Status"
docker compose ps
echo "Done. Follow the logs with: docker compose logs -f app worker"

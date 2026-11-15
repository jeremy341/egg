#!/bin/sh
# Make a consistent, compressed copy of the Egg database and keep the newest 14.
#
# Uses SQLite's own online backup, so it is safe while Egg is running (a plain file copy
# can catch a write half way through). Method, first one that works:
#   1. the sqlite3 command:  .backup
#   2. VACUUM INTO, run by node inside the running app container (needs docker compose)
#   3. VACUUM INTO, run by node on this machine (needs `pnpm install` in web/)
#
# Settings (environment variables, all optional):
#   EGG_DB       path of the database file   (default: $EGG_DATA_DIR/egg.db from .env, else web/data/egg.db)
#   BACKUP_DIR   where copies go              (default: ./backups in the repository root)
#   BACKUP_KEEP  how many copies to keep      (default: 14)
#   EGG_SKIP_IF_MISSING=1  exit 0 instead of failing when there is no database yet
#
# The copy holds sealed SSH keys and variables. It is useless without APP_SECRET, so keep
# APP_SECRET safe somewhere else, and treat the copies as secret too.

set -eu
umask 077

ROOT=$(cd "$(dirname "$0")/.." && pwd)
KEEP=${BACKUP_KEEP:-14}
BACKUP_DIR=${BACKUP_DIR:-$ROOT/backups}

# Read one value from the repository .env without running it as a script.
env_value() {
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^$1=//p" "$ROOT/.env" | tail -n 1
}

if [ -z "${EGG_DB:-}" ]; then
  data_dir=$(env_value EGG_DATA_DIR)
  if [ -n "$data_dir" ]; then
    EGG_DB=$data_dir/egg.db
  else
    EGG_DB=$ROOT/web/data/egg.db
  fi
fi

case "$KEEP" in
  ''|*[!0-9]*) echo "BACKUP_KEEP must be a whole number, got: $KEEP" >&2; exit 1 ;;
esac
if [ "$KEEP" -lt 1 ]; then
  echo "BACKUP_KEEP must be at least 1" >&2
  exit 1
fi

if [ ! -f "$EGG_DB" ]; then
  if [ "${EGG_SKIP_IF_MISSING:-0}" = 1 ]; then
    echo "No database at $EGG_DB yet, nothing to back up."
    exit 0
  fi
  echo "Database not found: $EGG_DB (set EGG_DB to its path)" >&2
  exit 1
fi

# The path ends up inside an SQL string, so refuse a quote in it.
case "$EGG_DB$BACKUP_DIR" in
  *"'"*) echo "A single quote in the database or backup path is not supported." >&2; exit 1 ;;
esac

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

stamp=$(date -u +%Y%m%dT%H%M%SZ)
final=$BACKUP_DIR/egg-$stamp.db
tmp=$final.partial
rm -f "$tmp"
trap 'rm -f "$tmp" "$tmp.gz"' EXIT INT TERM

node_vacuum='const {createClient}=require("@libsql/client");const c=createClient({url:"file:"+process.argv[1]});c.execute("VACUUM INTO \x27"+process.argv[2]+"\x27").then(()=>{c.close()},e=>{console.error(e.message);process.exit(1)})'

if command -v sqlite3 >/dev/null 2>&1; then
  echo "Backing up with sqlite3 .backup"
  sqlite3 "$EGG_DB" ".timeout 10000" ".backup '$tmp'"
elif command -v docker >/dev/null 2>&1 \
  && [ -f "$ROOT/compose.yaml" ] \
  && [ "$EGG_DB" = "$(env_value EGG_DATA_DIR)/egg.db" ] \
  && [ -n "$(cd "$ROOT" && docker compose ps -q app 2>/dev/null)" ]; then
  # The copy is written into the data folder (which the app container can write to),
  # compressed from there, and removed again by the container.
  echo "Backing up with VACUUM INTO inside the app container"
  raw=$(dirname "$EGG_DB")/.backup-$stamp.tmp
  (cd "$ROOT" && docker compose exec -T app node -e "$node_vacuum" /data/egg.db "/data/.backup-$stamp.tmp")
  gzip -c "$raw" > "$tmp.gz" || { (cd "$ROOT" && docker compose exec -T app rm -f "/data/.backup-$stamp.tmp"); exit 1; }
  (cd "$ROOT" && docker compose exec -T app rm -f "/data/.backup-$stamp.tmp")
elif command -v node >/dev/null 2>&1 && [ -d "$ROOT/web/node_modules/@libsql" ]; then
  echo "Backing up with VACUUM INTO using node"
  (cd "$ROOT/web" && node -e "$node_vacuum" "$EGG_DB" "$tmp")
else
  echo "No way to make a safe copy: install the sqlite3 command, or start the stack with docker compose." >&2
  exit 1
fi

if [ ! -s "$tmp" ] && [ ! -s "$tmp.gz" ]; then
  echo "The backup came out empty, so it was not kept." >&2
  exit 1
fi

if [ -s "$tmp" ]; then
  gzip -c "$tmp" > "$tmp.gz"
  rm -f "$tmp"
fi
mv "$tmp.gz" "$final.gz"
echo "Saved $final.gz"

# Keep the newest $KEEP copies. The timestamp in the name sorts oldest to newest.
count=0
ls -1 "$BACKUP_DIR" | grep '^egg-[0-9T]*Z\.db\.gz$' | sort -r | while IFS= read -r name; do
  count=$((count + 1))
  if [ "$count" -gt "$KEEP" ]; then
    rm -f "$BACKUP_DIR/$name"
    echo "Removed old copy $name"
  fi
done

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

# Compose's dotenv parser drops a trailing CR and one matching pair of quotes.
# Mirror that here, otherwise EGG_DATA_DIR="/srv/egg/data" is taken literally.
strip_value() {
  _v=$(printf '%s' "$1" | tr -d '\r')
  case "$_v" in
    \"*\") _v=${_v#\"}; _v=${_v%\"} ;;
    "'"*"'") _v=${_v#"'"}; _v=${_v%"'"} ;;
  esac
  printf '%s' "$_v"
}

# Read one value from the repository .env without running it as a script.
env_value() {
  [ -f "$ROOT/.env" ] || return 0
  _raw=$(sed -n "s/^$1=//p" "$ROOT/.env" | tail -n 1)
  strip_value "$_raw"
}

local_env_value() {
  [ -f "$ROOT/web/.env.local" ] || return 0
  _raw=$(sed -n "s/^$1=//p" "$ROOT/web/.env.local" | tail -n 1)
  strip_value "$_raw"
}

if [ -z "${EGG_DB:-}" ]; then
  data_dir=$(env_value EGG_DATA_DIR)
  configured_url=${DATABASE_URL:-$(env_value DATABASE_URL)}
  [ -n "$configured_url" ] || configured_url=$(local_env_value DATABASE_URL)
  # Do not silently back up a different database when a non-default URL is configured.
  if [ -n "$data_dir" ]; then
    case "$configured_url" in
      ''|file:/data/egg.db) ;;
      *) echo "DATABASE_URL is not the default; set EGG_DB to the actual database path." >&2; exit 1 ;;
    esac
    EGG_DB=$data_dir/egg.db
  else
    case "$configured_url" in
      ''|file:./data/egg.db) ;;
      *) echo "DATABASE_URL is not the default; set EGG_DB to the actual database path." >&2; exit 1 ;;
    esac
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

# cron, a manual run and upgrade.sh can overlap. Hold one exclusive lock for the
# whole run so nobody else touches our temp files, and give each run a unique id
# so even a leftover from a crashed run cannot be picked up.
if command -v flock >/dev/null 2>&1; then
  exec 9>>"$BACKUP_DIR/.backup.lock"
  flock -x 9
else
  echo "Warning: flock is unavailable; overlapping backups may collide." >&2
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
nanos=$(date -u +%N 2>/dev/null | tr -cd '0-9' || true)
[ -n "$nanos" ] || nanos=000000000
runid=$stamp-$$-$nanos

base=$BACKUP_DIR/egg-$runid.db
final=$base.gz
tmp=$base.partial
tmpgz=$tmp.gz
in_tmp=

# Create a temp file only when it does not already exist (noclobber / O_EXCL),
# never silently reuse or truncate one.
exclusive_create() {
  ( set -C; : > "$1" ) || {
    echo "Refusing to reuse existing temporary file $1" >&2
    exit 1
  }
}

# Runs on success, failure and signals. The in-container VACUUM output lives on
# the shared data volume, so it must go away on every exit path, not just on
# success (otherwise a retry fails with "output file already exists").
cleanup() {
  rm -f "$tmp" "$tmpgz"
  if [ -n "$in_tmp" ]; then
    (cd "$ROOT" && docker compose exec -T app rm -f "$in_tmp") 2>/dev/null || true
  fi
  return 0
}
trap cleanup EXIT INT TERM

exclusive_create "$tmp"
exclusive_create "$tmpgz"

node_vacuum='const {createClient}=require("@libsql/client");const c=createClient({url:"file:"+process.argv[1]});c.execute("VACUUM INTO \x27"+process.argv[2]+"\x27").then(()=>{c.close()},e=>{console.error(e.message);process.exit(1)})'

if [ -z "${EGG_CONTAINER_DB:-}" ] && command -v sqlite3 >/dev/null 2>&1; then
  echo "Backing up with sqlite3 .backup"
  sqlite3 "$EGG_DB" ".timeout 10000" ".backup '$tmp'"
elif command -v docker >/dev/null 2>&1 \
  && [ -f "$ROOT/compose.yaml" ] \
  && { [ -n "${EGG_CONTAINER_DB:-}" ] || [ "$EGG_DB" = "$(env_value EGG_DATA_DIR)/egg.db" ]; } \
  && [ -n "$(cd "$ROOT" && docker compose ps -q app 2>/dev/null)" ]; then
  # The copy is written into the data folder (which the app container can write to),
  # compressed from there, and removed again by the container.
  echo "Backing up with VACUUM INTO inside the app container"
  in_tmp=/data/.backup-$runid.tmp
  raw=${EGG_DATA_MOUNT:-$(dirname "$EGG_DB")}/.backup-$runid.tmp
  (cd "$ROOT" && docker compose exec -T app node -e "$node_vacuum" "${EGG_CONTAINER_DB:-/data/egg.db}" "$in_tmp")
  # SQLite leaves this world-readable (0644) on the shared volume, which also
  # holds sealed keys. Tighten it before compressing it into our private temp.
  (cd "$ROOT" && docker compose exec -T app chmod 600 "$in_tmp")
  gzip -c "$raw" > "$tmpgz"
  (cd "$ROOT" && docker compose exec -T app rm -f "$in_tmp")
  in_tmp=
elif command -v node >/dev/null 2>&1 && [ -d "$ROOT/web/node_modules/@libsql" ]; then
  echo "Backing up with VACUUM INTO using node"
  (cd "$ROOT/web" && node -e "$node_vacuum" "$EGG_DB" "$tmp")
else
  echo "No way to make a safe copy: install the sqlite3 command, or start the stack with docker compose." >&2
  exit 1
fi

if [ ! -s "$tmp" ] && [ ! -s "$tmpgz" ]; then
  echo "The backup came out empty, so it was not kept." >&2
  exit 1
fi

if [ -s "$tmp" ]; then
  gzip -c "$tmp" > "$tmpgz"
  rm -f "$tmp"
fi

# The run id makes this unique, but never overwrite an existing backup silently.
if [ -e "$final" ]; then
  echo "Backup target already exists: $final" >&2
  exit 1
fi
mv "$tmpgz" "$final"
echo "Saved $final"

# Keep the newest $KEEP copies. The timestamp (then pid/nanoseconds) in the name
# sorts oldest to newest. Names are egg-<UTCstamp>-<pid>-<nanos>.db.gz; the
# optional suffix still matches backups made by older versions of this script.
count=0
ls -1 "$BACKUP_DIR" | grep -E '^egg-[0-9]{8}T[0-9]{6}Z(-[0-9]+-[0-9]+)?\.db\.gz$' | sort -r | while IFS= read -r name; do
  count=$((count + 1))
  if [ "$count" -gt "$KEEP" ]; then
    rm -f "$BACKUP_DIR/$name"
    echo "Removed old copy $name"
  fi
done

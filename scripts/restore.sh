#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-t369}"
POSTGRES_DB="${POSTGRES_DB:-t369}"

usage() {
  printf "Usage: ./scripts/restore.sh [--yes] [--no-clean] <backup-file.zip|backup-file.tar.gz>\n"
  exit 1
}

CONFIRM=false
CLEAN_SCHEMA=true
ARCHIVE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes)
      CONFIRM=true
      ;;
    --no-clean)
      CLEAN_SCHEMA=false
      ;;
    -h|--help)
      usage
      ;;
    *)
      if [ -n "$ARCHIVE" ]; then
        usage
      fi
      ARCHIVE="$1"
      ;;
  esac
  shift
done

[ -n "$ARCHIVE" ] || usage

if [ ! -f "$ARCHIVE" ]; then
  printf "Backup archive not found: %s\n" "$ARCHIVE"
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

printf "Extracting archive: %s\n" "$ARCHIVE"
case "$ARCHIVE" in
  *.zip)
    if ! command -v unzip >/dev/null 2>&1; then
      printf "unzip is required to restore .zip backups. Install it and retry.\n"
      exit 1
    fi
    unzip -q "$ARCHIVE" -d "$TMP_DIR"
    ;;
  *.tar.gz)
    tar -xzf "$ARCHIVE" -C "$TMP_DIR"
    ;;
  *)
    printf "Unsupported backup format. Use .zip or .tar.gz\n"
    exit 1
    ;;
esac

if [ ! -f "$TMP_DIR/SHA256SUMS" ]; then
  printf "Integrity file SHA256SUMS not found in backup. Restore aborted.\n"
  exit 1
fi

printf "Verifying checksum...\n"
(cd "$TMP_DIR" && sha256sum -c SHA256SUMS)

SQL_FILE=$(find "$TMP_DIR" -maxdepth 1 -type f -name '*.sql' | head -n 1)
if [ -z "$SQL_FILE" ]; then
  printf "No SQL dump found in backup archive.\n"
  exit 1
fi

printf "Checking database health...\n"
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

if [ "$CONFIRM" = false ]; then
  printf "This will restore data into database '%s'.\n" "$POSTGRES_DB"
  if [ "$CLEAN_SCHEMA" = true ]; then
    printf "It will DROP and recreate schema 'public' first.\n"
  else
    printf "Schema cleanup is disabled (--no-clean). Existing objects may conflict.\n"
  fi
  printf "Type YES to continue: "
  read -r reply
  [ "$reply" = "YES" ] || { printf "Restore cancelled.\n"; exit 1; }
fi

if [ "$CLEAN_SCHEMA" = true ]; then
  printf "Cleaning existing schema...\n"
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
fi

printf "Restoring SQL dump...\n"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$SQL_FILE"

printf "Restore completed successfully.\n"

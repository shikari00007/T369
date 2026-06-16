#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-t369}"
POSTGRES_DB="${POSTGRES_DB:-t369}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-90}"

mkdir -p "$BACKUP_DIR"

LOCK_FILE="$BACKUP_DIR/.backup.lock"
if [ -f "$LOCK_FILE" ]; then
  printf "Another backup seems to be running (lock: %s).\n" "$LOCK_FILE"
  exit 1
fi
trap 'rm -f "$LOCK_FILE"' EXIT INT TERM
touch "$LOCK_FILE"

STAMP=$(date +%Y%m%d_%H%M%S)
BASE_NAME="t369_${STAMP}"
TMP_DIR=$(mktemp -d "$BACKUP_DIR/.tmp_${BASE_NAME}_XXXXXX")
SQL_FILE="$TMP_DIR/${BASE_NAME}.sql"
META_FILE="$TMP_DIR/metadata.txt"
SUM_FILE="$TMP_DIR/SHA256SUMS"
OUT_FILE="$BACKUP_DIR/${BASE_NAME}.zip"

printf "Checking database health...\n"
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

printf "Creating SQL dump...\n"
docker compose exec -T postgres pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB" > "$SQL_FILE"

printf "Creating backup metadata and checksum...\n"
{
  printf "created_at=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf "database=%s\n" "$POSTGRES_DB"
  printf "db_user=%s\n" "$POSTGRES_USER"
  printf "docker_service=postgres\n"
  printf "backup_format=sql\n"
} > "$META_FILE"

(cd "$TMP_DIR" && sha256sum "${BASE_NAME}.sql" > "SHA256SUMS")

if command -v zip >/dev/null 2>&1; then
  (cd "$TMP_DIR" && zip -q "$OLDPWD/$OUT_FILE" "${BASE_NAME}.sql" "SHA256SUMS" "metadata.txt")
else
  OUT_FILE="$BACKUP_DIR/${BASE_NAME}.tar.gz"
  tar -C "$TMP_DIR" -czf "$OUT_FILE" "${BASE_NAME}.sql" "SHA256SUMS" "metadata.txt"
fi

rm -rf "$TMP_DIR"

printf "Backup complete: %s\n" "$OUT_FILE"

if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 't369_*.zip' -o -name 't369_*.tar.gz' \) -mtime +"$RETENTION_DAYS" -print -delete >/dev/null 2>&1 || true
fi

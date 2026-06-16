# Backup & Recovery Guide

This guide gives you a safe, repeatable backup and restore workflow for Linux with Docker Compose.

It is designed for container failure scenarios so your PostgreSQL data is always recoverable from your Linux machine.

## What Is Included

The backup script now includes:

- SQL dump of the PostgreSQL database
- SHA256 checksum file for integrity verification
- Metadata file with backup timestamp and DB info
- Compressed archive output (`.zip` if available, otherwise `.tar.gz`)
- Retention cleanup (default 90 days)
- Concurrency lock to prevent overlapping backup runs

The restore script now includes:

- Archive extraction support for `.zip` and `.tar.gz`
- Mandatory checksum verification before restore
- Optional schema cleanup before restore (default enabled)
- Confirmation prompt to avoid accidental overwrite

## Prerequisites

1. Linux machine with Docker and Docker Compose plugin.
2. Project folder available locally.
3. Containers running:

```bash
docker compose up -d
```

4. Recommended tools on Linux:

```bash
sudo apt update
sudo apt install -y zip unzip coreutils
```

## Step 1: Run Manual Backup

From project root:

```bash
chmod +x scripts/backup.sh scripts/restore.sh
./scripts/backup.sh
```

Output is created in `backups/`:

- `t369_YYYYMMDD_HHMMSS.zip` (preferred)
- or `t369_YYYYMMDD_HHMMSS.tar.gz` (fallback)

## Step 2: Validate Backup Exists

```bash
ls -lh backups/
```

You should see a new archive file with current timestamp.

## Step 3: Restore After Container/Data Failure

Example recovery flow:

```bash
# 1) Make sure containers are running
docker compose up -d

# 2) Restore from a backup archive
./scripts/restore.sh backups/t369_YYYYMMDD_HHMMSS.zip
```

During restore:

- checksum is verified first
- you will be prompted to type `YES`
- schema `public` is dropped/recreated by default, then data is restored

### Non-Interactive Restore

```bash
./scripts/restore.sh --yes backups/t369_YYYYMMDD_HHMMSS.zip
```

### Restore Without Cleaning Schema (advanced)

```bash
./scripts/restore.sh --yes --no-clean backups/t369_YYYYMMDD_HHMMSS.zip
```

Use `--no-clean` only if you fully understand object conflicts and duplicate risk.

## Weekly Automated Backup (Linux Cron)

### 1. Add Cron Job

Run:

```bash
crontab -e
```

Add this line (every Sunday at 02:30):

```cron
30 2 * * 0 cd /absolute/path/to/3-6-9-App && ./scripts/backup.sh >> backups/backup-cron.log 2>&1
```

Replace `/absolute/path/to/3-6-9-App` with your real project path.

### 2. Verify Cron Is Registered

```bash
crontab -l
```

### 3. Check Weekly Result

```bash
tail -n 100 backups/backup-cron.log
ls -lh backups/
```

## Integrity Protection Logic

Backup integrity protection now includes:

1. Pre-backup DB readiness check with `pg_isready`
2. SHA256 checksum generation for SQL dump
3. Checksum verification before every restore
4. Safe archive extraction to temp folder
5. Optional schema reset to prevent partial/dirty state restores

## Retention Configuration

Default retention is 90 days.

Override retention days while running backup:

```bash
BACKUP_RETENTION_DAYS=180 ./scripts/backup.sh
```

Disable auto-delete by setting to `0`:

```bash
BACKUP_RETENTION_DAYS=0 ./scripts/backup.sh
```

## Disaster Recovery Checklist

If container failed or data seems corrupted:

1. Ensure Docker daemon is healthy.
2. Start services: `docker compose up -d`
3. Pick latest known good backup from `backups/`.
4. Restore with checksum validation:

```bash
./scripts/restore.sh backups/t369_YYYYMMDD_HHMMSS.zip
```

5. Confirm app health:

```bash
curl -s http://localhost:8080/health
```

6. Open app and verify latest expected records.

## Recommended Operational Practice

- Keep at least 4 weekly backups.
- Keep one monthly backup for long-term rollback.
- Occasionally test restore on a non-production copy.
- Copy backup archives to a second disk/location if possible.

This gives you reliable local-first recovery even if a container or volume fails.

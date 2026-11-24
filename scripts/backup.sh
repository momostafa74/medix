#!/usr/bin/env bash
# PostgreSQL backup with retention + integrity check + optional alert.
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/medix RETENTION_DAYS=14 ./scripts/backup.sh
# Cron (daily 03:15):  15 3 * * * cd /opt/medix && ./scripts/backup.sh >> logs/backup.log 2>&1
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/medix-$STAMP.dump"
mkdir -p "$BACKUP_DIR"

alert() {
  echo "[backup] $1"
  if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
    curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"text\":\"Medix backup: $1\"}" "$ALERT_WEBHOOK_URL" || true
  fi
}
trap 'alert "FAILED at $(date -u)"' ERR

# Custom format = compressed, supports selective/parallel restore.
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$FILE"
# Integrity check: the archive must be readable and list the appointments table.
LISTING="$(pg_restore --list "$FILE")"
grep -q "TABLE DATA public appointments" <<<"$LISTING" || { alert "integrity check failed for $FILE"; exit 1; }
sha256sum "$FILE" > "$FILE.sha256"

# Uploaded files (local storage driver). With S3, enable bucket versioning instead.
if [[ -d "${UPLOAD_DIR:-./backend/storage}" ]]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "${UPLOAD_DIR:-./backend/storage}" .
fi

find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -name 'medix-*' -delete
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -name 'uploads-*' -delete
date -u +%s > "$BACKUP_DIR/.last_success"   # monitored by scripts/check-backup.sh
echo "[backup] OK $FILE ($(du -h "$FILE" | cut -f1))"

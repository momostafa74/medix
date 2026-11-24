#!/usr/bin/env bash
# Backup monitoring: exits non-zero (and alerts) if the last successful backup is older than MAX_AGE_HOURS.
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-./backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
last=$(cat "$BACKUP_DIR/.last_success" 2>/dev/null || echo 0)
age=$(( ( $(date -u +%s) - last ) / 3600 ))
if (( age > MAX_AGE_HOURS )); then
  msg="Medix: last successful backup is ${age}h old"
  echo "$msg"
  [[ -n "${ALERT_WEBHOOK_URL:-}" ]] && curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$msg\"}" "$ALERT_WEBHOOK_URL" || true
  exit 1
fi
echo "OK: last backup ${age}h ago"

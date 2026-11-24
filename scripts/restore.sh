#!/usr/bin/env bash
# Restore a backup into a database. DESTRUCTIVE for the target database.
#   DATABASE_URL=postgresql://.../medix_restore ./scripts/restore.sh backups/medix-20261004T031500Z.dump
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL (target) is required}"
FILE="${1:?usage: restore.sh <backup.dump>}"
[[ -f "$FILE.sha256" ]] && sha256sum -c "$FILE.sha256"
read -r -p "This will REPLACE all data in the target database. Type 'restore' to continue: " ok
[[ "$ok" == "restore" ]] || { echo "aborted"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$FILE"
psql "$DATABASE_URL" -c "SELECT count(*) AS appointments FROM appointments;" -c "SELECT name FROM migrations ORDER BY id DESC LIMIT 1;"
echo "Restore complete. Start the API; it will apply any newer migrations automatically."

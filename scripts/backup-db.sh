#!/usr/bin/env bash
# Backup local SQLite (file:) or print Turso CLI hints.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

if [[ -n "${TURSO_DATABASE_URL:-}" && "${TURSO_DATABASE_URL}" != file:* ]]; then
  echo "Remote Turso URL detected."
  echo "Use: turso db shell <name> \".backup /tmp/stranger-$STAMP.db\""
  echo "Or platform PITR restore from the Turso dashboard."
  exit 0
fi

DB_PATH="${SQLITE_PATH:-$ROOT/local.db}"
if [[ ! -f "$DB_PATH" ]]; then
  echo "No local database at $DB_PATH"
  exit 1
fi

DEST="$OUT_DIR/local-$STAMP.db"
# Prefer sqlite3 online backup if available
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST'"
else
  cp -a "$DB_PATH" "$DEST"
  # copy wal/shm if present
  [[ -f "$DB_PATH-wal" ]] && cp -a "$DB_PATH-wal" "$DEST-wal" || true
  [[ -f "$DB_PATH-shm" ]] && cp -a "$DB_PATH-shm" "$DEST-shm" || true
fi

# keep last 14
ls -1t "$OUT_DIR"/local-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "Backup written: $DEST"

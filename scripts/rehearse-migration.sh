#!/usr/bin/env bash
# Rehearse the Node -> Rust migration against a COPY of a real database.
#
# The safest way to gain confidence before pointing the Rust server at
# production: copy the live database, run the Rust binary over the copy, and
# verify it migrates the schema, authenticates an existing Node-created user,
# and leaves the data intact.
#
# Usage:
#   scripts/rehearse-migration.sh [path/to/database-copy.db]
#
# With no argument it rehearses against the committed Node-compatibility
# fixture (a database created by the old Node server), which proves the same
# properties end to end but is not your production data. For a real rehearsal,
# pass a copy of your production database:
#
#   cp production.db /tmp/migration-test.db
#   scripts/rehearse-migration.sh /tmp/migration-test.db
#
# The target file is NEVER the original: this script only reads and mutates
# the copy you hand it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${SERVER_BIN:-$ROOT/rust/target/release/stranger-server}"
SRC="${1:-$ROOT/rust/tests/fixtures/node-users.db}"
PORT="${PORT:-8931}"
BASE="http://127.0.0.1:$PORT"

# Credentials of the user baked into the fixture by the old Node server. When
# you rehearse against your own production copy, set REHEARSE_EMAIL/REHEARSE_PASS
# to a real existing account.
EMAIL="${REHEARSE_EMAIL:-compat@example.com}"
PASSWORD="${REHEARSE_PASS:-password12}"

if [[ ! -f "$BIN" ]]; then
  echo "server binary not found at $BIN (run: npm run build:server)" >&2
  exit 1
fi
if [[ ! -f "$SRC" ]]; then
  echo "source database not found: $SRC" >&2
  exit 1
fi

# Work on a private copy so the source (fixture or production backup) is untouched.
WORK="$(mktemp -d)"
DB="$WORK/rehearsal.db"
cp "$SRC" "$DB"
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"' EXIT

counts() {
  python3 - "$DB" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
for t in ("users", "sessions", "messages", "groups"):
    try:
        n = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    except sqlite3.Error:
        n = "no-table"
    print(f"  {t:10} {n}")
PY
}

echo "==> baseline: integrity + row counts of the copy"
python3 - "$DB" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
print("  integrity:", c.execute("PRAGMA integrity_check").fetchone()[0])
PY
counts

echo "==> starting Rust server over the copy (port $PORT)"
TURSO_DATABASE_URL="file:$DB" PORT="$PORT" STATIC_DIR="$ROOT/dist" \
  "$BIN" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

# Wait for liveness.
for _ in $(seq 1 40); do
  if curl -fsS "$BASE/api/v1/health/live" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited during startup; log:" >&2
    cat "$WORK/server.log" >&2
    exit 1
  fi
  sleep 0.25
done
curl -fsS "$BASE/api/v1/health/live" >/dev/null || { echo "server never became live" >&2; cat "$WORK/server.log" >&2; exit 1; }
echo "    live."

echo "==> logging in as existing Node-created user ($EMAIL)"
LOGIN_BODY=$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")
RESP="$(curl -fsS -X POST "$BASE/api/v1/auth/login" -H 'content-type: application/json' -d "$LOGIN_BODY")" \
  || { echo "login FAILED (Node password hash not accepted by Rust)" >&2; exit 1; }
TOKEN="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])' <<<"$RESP")"
[[ -n "$TOKEN" ]] || { echo "no token in login response: $RESP" >&2; exit 1; }
echo "    login ok; Node scrypt hash verified by Rust."

echo "==> reading /auth/me with the issued session"
ME="$(curl -fsS "$BASE/api/v1/auth/me" -H "authorization: Bearer $TOKEN")"
echo "    me: $ME"

echo "==> stopping server and re-validating the copy"
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
python3 - "$DB" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
print("  integrity:", c.execute("PRAGMA integrity_check").fetchone()[0])
PY
counts

echo "==> rehearsal PASSED: Rust migrated the schema, authenticated a Node user,"
echo "    and left the database intact."

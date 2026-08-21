#!/usr/bin/env bash
# Rehearse the Node -> Rust migration against a COPY of a real database.
#
# The safest way to gain confidence before pointing the Rust server at
# production: copy the live database, run the Rust binary over the copy, and
# verify it migrates the schema, authenticates an existing Node-created user,
# honours an existing Node-issued session, and leaves the data intact.
#
# Usage:
#   scripts/rehearse-migration.sh [path/to/database-copy.db]
#
# IMPORTANT -- making the copy: for a `file:` SQLite database, stop the old
# (Node) server first, or use SQLite's online backup (`.backup` / the backup
# API). Copying only the `.db` while WAL mode is active can omit
# uncheckpointed data (the `-wal` / `-shm` sidecars).
#
#   # with the old server stopped:
#   cp production.db /tmp/migration-test.db
#   # or, without stopping it (safe with WAL):
#   sqlite3 production.db ".backup /tmp/migration-test.db"
#   REHEARSE_EMAIL=you@example.com REHEARSE_PASS='...' \
#   REHEARSE_EXISTING_TOKEN='<a live session token from the old server>' \
#     scripts/rehearse-migration.sh /tmp/migration-test.db
#
# With no argument it rehearses against the committed Node-compatibility
# fixture (a database created by the old Node server). In that mode it also
# reads the fixture's Node-issued "live" session token and verifies the Rust
# server accepts it, exercising existing-session continuity.
#
# The source file you pass is only ever read; this script works on a temp copy.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${SERVER_BIN:-$ROOT/rust/target/release/stranger-server}"
SRC="${1:-$ROOT/rust/tests/fixtures/node-users.db}"
PORT="${PORT:-8931}"
BASE="http://127.0.0.1:$PORT"

# Credentials of the user baked into the fixture by the old Node server. When
# you rehearse against your own production copy, set REHEARSE_EMAIL/REHEARSE_PASS
# to a real existing account, and REHEARSE_EXISTING_TOKEN to one of its live
# session tokens if you also want the session-continuity check.
EMAIL="${REHEARSE_EMAIL:-compat@example.com}"
PASSWORD="${REHEARSE_PASS:-password12}"
EXISTING_TOKEN="${REHEARSE_EXISTING_TOKEN:-}"
MANIFEST="$ROOT/rust/tests/fixtures/node-session-tokens.json"

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

SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

table_count() {
  python3 - "$DB" "$1" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
try:
    print(c.execute(f"SELECT COUNT(*) FROM {sys.argv[2]}").fetchone()[0])
except sqlite3.Error:
    print(-1)
PY
}

integrity_of() {
  python3 - "$DB" <<'PY'
import sqlite3, sys
print(sqlite3.connect(sys.argv[1]).execute("PRAGMA integrity_check").fetchone()[0])
PY
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "ASSERT FAILED: $label (expected=$expected actual=$actual)" >&2
    exit 1
  fi
}

echo "==> baseline: integrity + row counts of the copy"
assert_eq "baseline integrity" "ok" "$(integrity_of)"
base_users=$(table_count users)
base_sessions=$(table_count sessions)
base_messages=$(table_count messages)
base_groups=$(table_count groups)
echo "    users=$base_users sessions=$base_sessions messages=$base_messages groups=$base_groups"

# For the fixture, default the existing token to the Node-issued "live" session
# recorded in the manifest, so the default rehearsal proves session continuity.
if [[ -z "$EXISTING_TOKEN" && "$SRC" == "$ROOT/rust/tests/fixtures/node-users.db" && -f "$MANIFEST" ]]; then
  EXISTING_TOKEN="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["live"])' <"$MANIFEST")"
fi

echo "==> starting Rust server over the copy (port $PORT)"
TURSO_DATABASE_URL="file:$DB" PORT="$PORT" STATIC_DIR="$ROOT/dist" \
  "$BIN" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "$BASE/api/v1/health/live" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited during startup; log:" >&2
    cat "$WORK/server.log" >&2
    exit 1
  fi
  sleep 0.25
done
curl -fsS "$BASE/api/v1/health/live" >/dev/null || {
  echo "server never became live" >&2; cat "$WORK/server.log" >&2; exit 1;
}
echo "    live."

# 1) Existing-session continuity: a token minted by Node must resolve on Rust,
#    before we do anything else.
if [[ -n "$EXISTING_TOKEN" ]]; then
  echo "==> verifying an EXISTING Node-issued session token resolves (pre-login)"
  ME_EXISTING="$(curl -fsS "$BASE/api/v1/auth/me" -H "authorization: Bearer $EXISTING_TOKEN")" \
    || { echo "existing Node session token NOT accepted by Rust" >&2; exit 1; }
  existing_email="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["user"]["email"])' <<<"$ME_EXISTING")"
  assert_eq "existing-session /auth/me email" "$EMAIL" "$existing_email"
  echo "    existing Node session accepted (user=$existing_email)."
else
  echo "==> no existing token supplied; skipping session-continuity check"
fi

# 2) Password compatibility: log in as the Node-created user.
echo "==> logging in as existing Node-created user ($EMAIL)"
LOGIN_BODY=$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")
RESP="$(curl -fsS -X POST "$BASE/api/v1/auth/login" -H 'content-type: application/json' -d "$LOGIN_BODY")" \
  || { echo "login FAILED (Node password hash not accepted by Rust)" >&2; exit 1; }
TOKEN="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])' <<<"$RESP")"
[[ -n "$TOKEN" ]] || { echo "no token in login response: $RESP" >&2; exit 1; }
echo "    login ok; Node scrypt hash verified by Rust."

echo "==> reading /auth/me with the newly issued session"
ME="$(curl -fsS "$BASE/api/v1/auth/me" -H "authorization: Bearer $TOKEN")"
me_email="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["user"]["email"])' <<<"$ME")"
assert_eq "/auth/me email" "$EMAIL" "$me_email"
echo "    me email=$me_email."

echo "==> stopping server and re-validating the copy"
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

assert_eq "post integrity" "ok" "$(integrity_of)"
post_users=$(table_count users)
post_sessions=$(table_count sessions)
post_messages=$(table_count messages)
post_groups=$(table_count groups)

assert_eq "users unchanged"    "$base_users"    "$post_users"
assert_eq "messages unchanged" "$base_messages" "$post_messages"
assert_eq "groups unchanged"   "$base_groups"   "$post_groups"
# login intentionally creates exactly one new session; /auth/me creates none.
assert_eq "sessions = baseline + 1 (the login)" "$((base_sessions + 1))" "$post_sessions"

echo "==> counts: users=$post_users sessions=$post_sessions messages=$post_messages groups=$post_groups"
if [[ -n "$EXISTING_TOKEN" ]]; then
  echo "==> rehearsal PASSED: Rust migrated the schema, honoured an existing Node"
  echo "    session, authenticated a Node user, and left the data intact."
else
  echo "==> rehearsal PASSED: Rust migrated the schema, authenticated a Node user,"
  echo "    and left the data intact. (Session continuity not tested: pass"
  echo "    REHEARSE_EXISTING_TOKEN to include it.)"
fi

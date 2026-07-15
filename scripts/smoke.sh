#!/usr/bin/env bash
# Quick post-deploy smoke checks.
set -euo pipefail

BASE="${1:-http://127.0.0.1:8787}"
ADMIN_KEY="${ADMIN_KEY:-}"

echo "→ health $BASE/api/health"
curl -fsS "$BASE/api/health" | grep -q '"ok":true'

echo "→ ice"
curl -fsS "$BASE/api/ice" | grep -q iceServers

echo "→ spa"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
[[ "$code" == "200" ]]

if [[ -n "$ADMIN_KEY" ]]; then
  echo "→ admin overview"
  curl -fsS -H "x-admin-key: $ADMIN_KEY" "$BASE/api/admin/overview" | grep -q metrics
fi

echo "→ register/login"
email="smoke_$(date +%s)@example.com"
reg=$(curl -fsS -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"password12\",\"birthDate\":\"1990-01-01\"}")
echo "$reg" | grep -q token

echo "OK smoke passed against $BASE"

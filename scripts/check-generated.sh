#!/usr/bin/env bash
# Fails if shared/generated/ is out of date with rust/src/proto/.
#
# this check fails, run `cargo test` in rust/ and commit the result.
set -euo pipefail

cd "$(dirname "$0")/.."

(cd rust && cargo test --quiet >/dev/null)

if ! git diff --quiet -- shared/generated; then
  echo "error: shared/generated is stale — regenerate with (cd rust && cargo test) and commit." >&2
  git --no-pager diff --stat -- shared/generated >&2
  exit 1
fi

echo "shared/generated is up to date"

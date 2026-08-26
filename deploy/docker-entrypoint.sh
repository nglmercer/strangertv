#!/bin/sh
# Container entrypoint: apply the Better Auth schema, then run the server.
#
# The server binary deliberately never applies auth DDL -- see
# docs/migration-plan.md -- and on a platform whose database lives in a
# container volume (Railway, Fly) there is no convenient moment to run the
# migration by hand before the first boot. Doing it here keeps the invariant
# (the migration is still a separate, explicit command) while making a fresh
# volume work on its own. `migrate-auth` is idempotent, so this is a no-op on
# every start after the first.
#
# Set SKIP_AUTH_MIGRATION=1 to hand the step back to a deploy pipeline that
# runs it out of band.
set -e

# `docker compose run stranger migrate-auth-users` and friends: run exactly
# what was asked for and nothing else.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${SKIP_AUTH_MIGRATION:-0}" = "1" ]; then
  echo '{"level":"info","msg":"auth.migration_skipped","reason":"SKIP_AUTH_MIGRATION=1"}'
else
  /usr/local/bin/migrate-auth
fi

exec /usr/local/bin/stranger-server

# Deploy guide

## Quick local production mode

```bash
npm run build:all   # SPA (vite) + server binary (cargo --release)
NODE_ENV=production ADMIN_KEY=secret \
  BETTER_AUTH_SECRET='replace-with-at-least-32-random-bytes' \
  CORS_ORIGINS=http://localhost:8787 APP_URL=http://localhost:8787 npm start
# open http://localhost:8787  and  http://localhost:8787/admin
```

The Rust server serves the Vite `dist/` SPA, `/api/v1/*`, and `/ws`.

## Docker

```bash
export ADMIN_KEY=your-long-secret
export BETTER_AUTH_SECRET=your-at-least-32-byte-auth-secret
docker compose up --build -d
```

By default the compose file keeps a local SQLite at `file:/data/local.db` on the
named volume `stranger-data`. The image runs as a non-root user (uid 10001) and
pre-creates/chowns `/data`, so the container can create the database on a fresh
volume at first start. Point `TURSO_DATABASE_URL` at a hosted Turso DB instead
for anything beyond a single node.

## Required env (production)

| Variable | Purpose |
|----------|---------|
| `ADMIN_KEY` | Moderation console + `/api/v1/metrics` |
| `CORS_ORIGINS` | Comma-separated browser origins |
| `APP_URL` | Public URL (password-reset links) |
| `BETTER_AUTH_SECRET` | Secret used to sign Better Auth cookies; at least 32 bytes |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Hosted DB (preferred over file) |
| `TURN_SECRET` / `TURN_URLS` | Coturn-style REST credentials |
| `EMAIL_WEBHOOK_URL` | POST JSON mailer for password reset |
| `NODE_ENV=production` | Enables HSTS + CSP |

## Google sign-in (optional)

Set both variables and the "Continue with Google" button appears; leave either
empty and every other auth path is unaffected.

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Web application client id |
| `GOOGLE_CLIENT_SECRET` | Its client secret |
| `OAUTH_REDIRECT_BASE_URL` | Only for split dev setups; defaults to `APP_URL` |

In Google Cloud Console → *APIs & Services* → *Credentials*, create an OAuth
2.0 Client ID of type **Web application** and register the redirect URI:

```text
https://your-domain/api/v1/auth/oauth/google/callback
```

It must match the deployment exactly — scheme, host and path — for the host
the browser actually visits. Apex and `www` are different origins; register
whichever one `APP_URL` names. For local development against Vite, the API is
on a different port than the SPA:

```bash
OAUTH_REDIRECT_BASE_URL=http://localhost:8787   # register this callback too
```

Startup logs `oauth.google` with `configured: true|false`, so a deploy that
silently lacks the credentials is visible in the deploy log.

Notes on behavior:

- Google returns no birth date, and this service is 18+. A first-time Google
  user is redirected back with a short-lived, single-use token and asked for a
  birthday; the account only exists once that is supplied.
- An address that already has a password account is adopted, not duplicated:
  the Google identity is linked to the existing user.
- Provider-only accounts have no usable password. Their owners must use the
  password-reset flow to add one.

## Reverse proxy (Caddy example)

```caddyfile
chat.example.com {
  reverse_proxy localhost:8787
}
```

Terminate TLS at the proxy; set `APP_URL=https://chat.example.com` and include that origin in `CORS_ORIGINS`.

## Better Auth schema migration

The server connects Better Auth during startup but never applies its schema.
Run the explicit migration command once against the deployment database before
starting the new server, and repeat it safely when needed:

```bash
BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  TURSO_DATABASE_URL="$TURSO_DATABASE_URL" \
  TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
  npm run migrate:auth
```

For the Docker image, run the schema command and then the restartable user
import command explicitly:

```bash
docker compose run --rm stranger migrate-auth
docker compose run --rm stranger migrate-auth-users --dry-run
docker compose run --rm stranger migrate-auth-users
```

The last command preserves numeric StrangerTV IDs and is safe to repeat.

**The Docker image does this for you.** Its entrypoint runs `migrate-auth`
before the server, so a fresh deployment -- Railway, Fly, `docker compose up`,
anything whose database lives in a container volume where there is no good
moment to run a command by hand -- comes up migrated. The migration is
idempotent, so it is a no-op on every later start.

Set `SKIP_AUTH_MIGRATION=1` to take the step back, which is what you want when
several replicas start at once (they would all race the same DDL) or when a
deploy pipeline already runs the migration out of band. Run it as a one-off
job instead:

```bash
docker compose run --rm stranger migrate-auth
```

The server binary itself still never applies auth DDL. Password sign-in
tolerates a missing schema and falls back to the legacy path, so a gap here is
easy to miss; Google sign-in cannot, because it keeps its OAuth state in
Better Auth's key/value table. When the schema is absent the server logs
`oauth.google_schema_missing` at startup and the sign-in endpoint answers 503
rather than failing obscurely.

The migration bridge keeps the legacy bearer session available for rollback and
older clients. A successful Better Auth login/registration also sets the
HttpOnly `better-auth.session_token` cookie; browser requests must send
`credentials: include`. The public API still returns a temporary legacy token
until the cutover gate in `docs/migration-plan.md` is satisfied.

For a large database, review a bounded import before applying it and continue
with numeric ID checkpoints:

```bash
npm run migrate:auth-users -- --dry-run --limit 1000
npm run migrate:auth-users -- --after-id 999 --limit 1000
```

Rollback during the bridge is a server/application rollback: stop the new
binary, point the old release at the same database, and leave both Better Auth
tables and legacy hashes/sessions intact. Do not drop Better Auth tables or
clear `users.password_hash` until the production gate has passed.

For the cutover decision, monitor the private /api/v1/metrics endpoint (or
the Prometheus endpoint) for legacy_session_fallback,
auth_session_legacy_fallback, auth_password_legacy_verified, and
auth_password_legacy_rehashed. Keep the legacy bridge enabled until
legacy_session_fallback is effectively zero for longer than the complete
14-day legacy session lifetime, and review importer conflicts before stopping
legacy-session issuance. Phase 17/18 cleanup remains a separate,
post-rollback operation.

## TURN (coturn)

1. Run coturn with a static auth secret.
2. Set `TURN_SECRET` to that secret.
3. Set `TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349`.

## Backups (Turso)

```bash
turso db shell your-db ".backup /tmp/backup.db"
# or use Turso platform point-in-time restore
```

For `file:` SQLite, copy the db file while the process is stopped or use SQLite online backup.

## Migration rehearsal (Node -> Rust)

Before pointing the Rust server at a real database, rehearse on a copy. The
script starts the release binary over a private copy of the DB and asserts:
the schema migrates; an existing Node-issued session token still resolves (if
you supply one); a Node-created user can log in (scrypt password-hash
compatibility); and `users`/`messages`/`groups` counts are unchanged afterwards
(`sessions` grows by exactly one, from the rehearsal login).

First make a safe copy. For a `file:` SQLite DB, stop the old server first, or
use SQLite's online backup — a plain `cp` while WAL is active can omit
uncheckpointed data:

```bash
npm run build:server

# with the old server stopped:
cp production.db /tmp/migration-test.db
# or, safe without stopping it:
sqlite3 production.db ".backup /tmp/migration-test.db"

REHEARSE_EMAIL=you@example.com REHEARSE_PASS='...' \
REHEARSE_EXISTING_TOKEN='<a live session token from the old server>' \
  scripts/rehearse-migration.sh /tmp/migration-test.db
```

`REHEARSE_EXISTING_TOKEN` is optional; without it the session-continuity check
is skipped and the rehearsal proves password compatibility only. With no
argument the script rehearses against the committed Node-compatibility fixture
and reads a Node-issued live token from it, so both checks run by default. The
source file you pass is only ever read; the script works on a temp copy.

## Ops endpoints

- `GET /api/v1/health` — summary + queue sizes  
- `GET /api/v1/health/live` — process up (k8s liveness)  
- `GET /api/v1/health/ready` — DB + not draining (k8s readiness)  
- `GET /api/v1/metrics` — JSON counters (`x-admin-key` unless `METRICS_PUBLIC=1`)  
- `GET /api/v1/metrics/prometheus` — Prometheus text format  
- `GET /admin` — moderation UI  
- Admin API: `/api/v1/admin/overview`, `reports`, `bans`, `users`, `ban`  
- Graceful shutdown: `SIGTERM`/`SIGINT` drain WS for `SHUTDOWN_DRAIN_MS` then exit  

## Example configs

- `deploy/Caddyfile` — TLS reverse proxy  
- `deploy/nginx.conf` — nginx + WebSocket upgrade  
- `deploy/turnserver.conf.example` — coturn  
- `deploy/systemd/stranger.service` — systemd unit. `ProtectSystem=strict` leaves
  only `/opt/stranger/data` writable, so the unit defaults `TURSO_DATABASE_URL` to
  `file:/opt/stranger/data/local.db`. An explicit value in `/opt/stranger/.env`
  overrides that default (EnvironmentFile wins over Environment). Create
  `/opt/stranger/data` and chown it to the service user before first start.

## Load test & smoke

```bash
# server must be running
npm run loadtest -- --clients=40 --seconds=30
ADMIN_KEY=secret npm run smoke -- http://127.0.0.1:8787
npm run backup
```

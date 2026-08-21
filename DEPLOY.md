# Deploy guide

## Quick local production mode

```bash
npm run build:all   # SPA (vite) + server binary (cargo --release)
NODE_ENV=production ADMIN_KEY=secret CORS_ORIGINS=http://localhost:8787 APP_URL=http://localhost:8787 npm start
# open http://localhost:8787  and  http://localhost:8787/admin
```

The Rust server serves the Vite `dist/` SPA, `/api/v1/*`, and `/ws`.

## Docker

```bash
export ADMIN_KEY=your-long-secret
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
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Hosted DB (preferred over file) |
| `TURN_SECRET` / `TURN_URLS` | Coturn-style REST credentials |
| `EMAIL_WEBHOOK_URL` | POST JSON mailer for password reset |
| `NODE_ENV=production` | Enables HSTS + CSP |

## Reverse proxy (Caddy example)

```caddyfile
chat.example.com {
  reverse_proxy localhost:8787
}
```

Terminate TLS at the proxy; set `APP_URL=https://chat.example.com` and include that origin in `CORS_ORIGINS`.

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
script starts the release binary over a private copy of the DB, verifies the
schema migrates, logs in as an existing Node-created user (proving the scrypt
password-hash and session-token compatibility end to end), and re-checks the
data is intact afterwards:

```bash
npm run build:server
cp production.db /tmp/migration-test.db
REHEARSE_EMAIL=you@example.com REHEARSE_PASS='...' \
  scripts/rehearse-migration.sh /tmp/migration-test.db
```

With no argument it rehearses against the committed Node-compatibility fixture.
The source file you pass is only ever read; the script works on a temp copy.

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

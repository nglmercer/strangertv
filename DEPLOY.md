# Deploy guide

## Quick local production mode

```bash
npm run build
NODE_ENV=production ADMIN_KEY=secret CORS_ORIGINS=http://localhost:8787 APP_URL=http://localhost:8787 npm start
# open http://localhost:8787  and  http://localhost:8787/admin
```

The Hono server serves the Vite `dist/` SPA, `/api/*`, and `/ws`.

## Docker

```bash
export ADMIN_KEY=your-long-secret
docker compose up --build -d
```

## Required env (production)

| Variable | Purpose |
|----------|---------|
| `ADMIN_KEY` | Moderation console + `/api/metrics` |
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

## Ops endpoints

- `GET /api/health` — summary + queue sizes  
- `GET /api/health/live` — process up (k8s liveness)  
- `GET /api/health/ready` — DB + not draining (k8s readiness)  
- `GET /api/metrics` — JSON counters (`x-admin-key` unless `METRICS_PUBLIC=1`)  
- `GET /api/metrics/prometheus` — Prometheus text format  
- `GET /admin` — moderation UI  
- Admin API: `/api/admin/overview`, `reports`, `bans`, `users`, `ban`  
- Graceful shutdown: `SIGTERM`/`SIGINT` drain WS for `SHUTDOWN_DRAIN_MS` then exit  

## Example configs

- `deploy/Caddyfile` — TLS reverse proxy  
- `deploy/nginx.conf` — nginx + WebSocket upgrade  
- `deploy/turnserver.conf.example` — coturn  
- `deploy/systemd/stranger.service` — systemd unit  

## Load test & smoke

```bash
# server must be running
npm run loadtest -- --clients=40 --seconds=30
ADMIN_KEY=secret npm run smoke -- http://127.0.0.1:8787
npm run backup
```

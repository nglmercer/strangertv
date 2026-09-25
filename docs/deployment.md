# Deployment

How to run stranger in production. Auth-specific deploy steps (Google
sign-in, Better Auth migration) live in [Authentication](./authentication.md);
day-2 operations in [Operations](./operations.md).

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

By default the compose file keeps a local SQLite at `file:/data/local.db` on
the named volume `stranger-data`. The image runs as a non-root user (uid
10001) and pre-creates/chowns `/data`, so the container can create the
database on a fresh volume at first start. Point `TURSO_DATABASE_URL` at a
hosted Turso DB instead for anything beyond a single node.

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

Full reference: [Configuration](./configuration.md).

## Reverse proxy (Caddy example)

```caddyfile
chat.example.com {
  reverse_proxy localhost:8787
}
```

Terminate TLS at the proxy; set `APP_URL=https://chat.example.com` and include
that origin in `CORS_ORIGINS`.

## Example configs

- `deploy/Caddyfile` — TLS reverse proxy
- `deploy/nginx.conf` — nginx + WebSocket upgrade
- `deploy/turnserver.conf.example` — coturn (see [WebRTC](./webrtc.md))
- `deploy/systemd/stranger.service` — systemd unit. `ProtectSystem=strict`
  leaves only `/opt/stranger/data` writable, so the unit defaults
  `TURSO_DATABASE_URL` to `file:/opt/stranger/data/local.db`. An explicit
  value in `/opt/stranger/.env` overrides that default (EnvironmentFile wins
  over Environment). Create `/opt/stranger/data` and chown it to the service
  user before first start.
- `deploy/k8s/` — Kubernetes sample (liveness: `/api/v1/health/live`,
  readiness: `/api/v1/health/ready`)

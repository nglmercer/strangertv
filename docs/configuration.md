# Configuration

Every setting comes from the environment. Start from
[`.env.example`](../.env.example) (`cp .env.example .env`).

## Server

| Variable | Purpose |
|----------|---------|
| `PORT` | API/WS listen port (default `8787`) |
| `NODE_ENV=production` | Enables HSTS + CSP |
| `STATIC_DIR` | SPA directory the server serves (dev uses `../dist`) |
| `LOG_LEVEL` | Log verbosity (`info` default) |
| `APP_VERSION` | Reported on `/api/health` (set by `start:prod`) |

## URLs & origins

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Public URL (password-reset / verify links, OAuth default) |
| `CORS_ORIGINS` | Allowed browser origins (comma-separated) |

## Database

| Variable | Purpose |
|----------|---------|
| `TURSO_DATABASE_URL` | Hosted libSQL URL, or `file:` SQLite locally |
| `TURSO_AUTH_TOKEN` | Hosted libSQL auth token |

Hosted Turso is preferred in production; see
[Deployment](./deployment.md).

## Auth

| Variable | Purpose |
|----------|---------|
| `BETTER_AUTH_SECRET` | Signs Better Auth cookies; at least 32 random bytes; required in production |
| `SKIP_AUTH_MIGRATION` | `1` skips the container-entrypoint `migrate-auth` (multi-replica rollouts) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in; leave both empty to keep it off |
| `OAUTH_REDIRECT_BASE_URL` | Only for split dev setups; defaults to `APP_URL` |
| `EMAIL_WEBHOOK_URL` | POST JSON mailer for password-reset / verify delivery |
| `MAIL_FROM` | Sender address |
| `SMTP_URL` | SMTP delivery (when set) |

Auth behavior: [Authentication](./authentication.md).

## WebRTC

| Variable | Purpose |
|----------|---------|
| `TURN_SECRET` | Coturn-style REST secret |
| `TURN_URLS` | Comma-separated `turn:`/`turns:` URLs |

Setup: [WebRTC / TURN](./webrtc.md).

## Admin & ops

| Variable | Purpose |
|----------|---------|
| `ADMIN_KEY` | Moderation console + private metrics |
| `METRICS_PUBLIC` | `1` exposes `/api/v1/metrics` without `x-admin-key` |
| `SHUTDOWN_DRAIN_MS` | Graceful WebSocket drain on shutdown |
| `ALERT_WEBHOOK_URL` | Report-spike alert delivery |
| `ALERT_REPORTS_THRESHOLD` | Reports threshold for alerts |

Endpoints: [Operations](./operations.md).

## Feature flags & tuning

| Variable | Purpose |
|----------|---------|
| `FEATURE_ANONYMOUS_MATCH` | Allow matching without an account |
| `FEATURE_GUEST_REPORTS` | Allow reports without an account |
| `FEATURE_QUALITY_TELEMETRY` | Collect call-quality telemetry |
| `FEATURE_REQUIRE_EMAIL_VERIFIED` | Require verified email for matching |
| `REMATCH_COOLDOWN_MS` | Cooldown between rematches |

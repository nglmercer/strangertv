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
| `TRUSTED_PROXIES` | Comma-separated proxy IPs/CIDRs whose `x-forwarded-for` / `x-real-ip` headers are honored (default: trust none; see below) |

## Trusted proxies

Rate limits, bans, reports, ratings, and login/reset limits are all keyed by
client IP. Forwarded headers are honored **only** when the direct socket peer
matches `TRUSTED_PROXIES`; otherwise the socket peer address is the client IP,
so arbitrary clients cannot spoof their identity with an `x-forwarded-for`
header.

Set it to your load balancer / ingress addresses, e.g.
`TRUSTED_PROXIES=10.0.0.0/8,192.168.1.10`. Behind no proxy, leave it empty and
every request is attributed to its socket peer. When a trusted proxy is in
play, the leftmost `x-forwarded-for` entry (else `x-real-ip`) becomes the
client IP. Invalid entries are ignored (fail closed).

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
| `TURN_SECRET` | Coturn-style REST secret; required and strong (≥32 chars, not a placeholder) when `TURN_URLS` is set — the server refuses to start otherwise |
| `TURN_URLS` | Comma-separated `turn:`/`turns:` URLs; empty disables TURN |

Setup: [WebRTC / TURN](./webrtc.md).

## Admin & ops

| Variable | Purpose |
|----------|---------|
| `ADMIN_KEY` | Moderation console + private metrics. Production requires a strong value (≥16 chars, not `change-me`/`secret`/`admin`/`test`/…); startup fails fast otherwise. Non-production falls back to a documented dev-only default with a loud warning |
| `METRICS_PUBLIC` | `1` exposes `/api/v1/metrics` without `x-admin-key` |
| `SHUTDOWN_DRAIN_MS` | Graceful WebSocket drain on shutdown |
| `ALERT_WEBHOOK_URL` | Report-spike alert delivery |
| `ALERT_REPORTS_THRESHOLD` | Reports threshold for alerts |

Endpoints: [Operations](./operations.md).

## Feature flags & tuning

| Variable | Purpose |
|----------|---------|
| `FEATURE_ANONYMOUS_MATCH` | Allow matching without an account (default off — anonymous users have no server-verifiable age; see [Safety](./safety.md)) |
| `FEATURE_GUEST_REPORTS` | Allow reports without an account |
| `FEATURE_QUALITY_TELEMETRY` | Collect call-quality telemetry |
| `FEATURE_REQUIRE_EMAIL_VERIFIED` | Require verified email for matching |
| `REMATCH_COOLDOWN_MS` | Cooldown between rematches |

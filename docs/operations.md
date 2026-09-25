# Operations

Health, metrics, admin, backups, and post-deploy checks for a running server.

## Ops endpoints

- `GET /api/v1/health` — summary + queue sizes
- `GET /api/v1/health/live` — process up (k8s liveness)
- `GET /api/v1/health/ready` — DB + not draining (k8s readiness)
- `GET /api/v1/metrics` — JSON counters (`x-admin-key` unless
  `METRICS_PUBLIC=1`)
- `GET /api/v1/metrics/prometheus` — Prometheus text format
- `GET /admin` — moderation UI
- Admin API: `/api/v1/admin/overview`, `reports`, `bans`, `users`, `ban`
- Graceful shutdown: `SIGTERM`/`SIGINT` drain WS for `SHUTDOWN_DRAIN_MS`
  then exit

## Admin console

`/admin` (guarded by `ADMIN_KEY`) covers the report queue with status filter
(open/resolved/all), bans, users, overview metrics, average ratings, open
report counts, CSV export (`/api/v1/admin/reports.csv`), and spike/underage
alerts. See [Safety](./safety.md) for the moderation policy side.

## Backups

Turso:

```bash
turso db shell your-db ".backup /tmp/backup.db"
# or use Turso platform point-in-time restore
```

For `file:` SQLite, copy the db file while the process is stopped or use
SQLite online backup. Local helper:

```bash
npm run backup
```

## Load test & smoke

```bash
# server must be running
npm run loadtest -- --clients=40 --seconds=30
ADMIN_KEY=secret npm run smoke -- http://127.0.0.1:8787
npm run backup
```

Related: [Deployment](./deployment.md) · [Configuration](./configuration.md).

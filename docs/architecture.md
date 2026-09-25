# Architecture

**Stack:** Preact + Vite (TypeScript) · axum + tokio (Rust) · libSQL / Turso ·
WebRTC.

| Route | Serving |
|-------|---------|
| `/` | Match, video, chat (SPA) |
| `/admin` | Reports, bans, metrics (SPA, `ADMIN_KEY`) |
| `/api/v1/*` | REST API (Rust) |
| `/ws` | Matchmaking + signaling WebSocket (Rust) |
| `/api/v1/docs` | OpenAPI |

The Rust server also serves the built Vite `dist/` SPA in production, so a
single process handles web, API, and WebSocket traffic on one port.

## Project layout

```
src/           Preact UI (components, hooks, i18n)
rust/          axum API, WebSocket matchmaking, auth, admin
rust/src/routes/   REST handlers (auth, admin, health, social, groups, …)
rust/src/ws/       WebSocket matchmaking + signaling
rust/src/auth/     Better Auth integration, sessions, OAuth
rust/src/bin/      migrate-auth, migrate-auth-users commands
shared/        Shared types & preference codes (generated/ comes from rust/src/proto)
deploy/        Caddy, nginx, systemd, k8s, coturn example
e2e/           Playwright specs
tests/         Vitest black-box HTTP/WS suites
scripts/       backup, load-test, smoke, migration rehearsal
```

## Request flow

1. Anonymous or authenticated client opens `/` and joins the matchmaking queue
   over `/ws` with validated preferences.
2. The server pairs compatible queue entries, creates an ephemeral room, and
   relays WebRTC signaling (`offer`/`answer`/ICE) between the two peers.
3. Media flows peer-to-peer via WebRTC; the server never records it.
4. Text chat is relayed through the room and not persisted.
5. Reports/blocks end the room immediately and feed the admin console.

## Data

- libSQL locally (`file:` SQLite), hosted Turso in production
- `users`, `sessions`, groups/social tables, reports, bans, ratings
- Better Auth tables live alongside the legacy schema during the auth bridge
  (see [Authentication](./authentication.md))

Related: [Development](./development.md) ·
[Configuration](./configuration.md).

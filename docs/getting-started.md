# Getting started

Local development setup for stranger. For production deploys see
[Deployment](./deployment.md); for every setting see
[Configuration](./configuration.md).

## Prerequisites

- **Node.js** for the client toolchain (Vite, tests, scripts)
- **Rust** (`cargo`) for the API server in `rust/`
- `bun` as a frontend package runner is fine

## Dev servers

```bash
npm install
cp .env.example .env   # optional for local defaults
npm run dev
```

| Service | URL |
|---------|-----|
| Vite SPA | http://localhost:5173 |
| API + WebSocket | http://localhost:8787 |

Open the SPA; it proxies API/WS to the backend in dev. `npm run dev` runs
Vite plus `cargo watch -x run` in `rust/` (with `STATIC_DIR=../dist`).

If a port is already taken (`EADDRINUSE`), a leftover process still owns it:

```bash
npm run free-ports   # or: npm run dev:fresh
```

## Production on one port

API, WebSocket, and the built SPA share one port. From the repo root:

```bash
npm run build:all
NODE_ENV=production \
BETTER_AUTH_SECRET='replace-with-at-least-32-random-bytes' \
ADMIN_KEY=secret \
  CORS_ORIGINS=http://localhost:8787 \
  APP_URL=http://localhost:8787 \
  npm start
```

Use a unique randomly generated `BETTER_AUTH_SECRET` in production; never use
the example value above literally.

- App: http://localhost:8787
- Admin: http://localhost:8787/admin

## Docker

```bash
export ADMIN_KEY=your-long-secret
export BETTER_AUTH_SECRET=your-at-least-32-byte-auth-secret
docker compose up --build
# with optional coturn profile:
# docker compose --profile turn up --build
```

Details: [Deployment](./deployment.md) · [WebRTC / TURN](./webrtc.md).

## Next steps

- [Features](./features.md) — what the app does
- [Architecture](./architecture.md) — how the code is laid out
- [Development](./development.md) — scripts, checks, conventions
- [Testing](./testing.md) — how to run each suite

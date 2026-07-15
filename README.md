# stranger

Anonymous 1:1 **live video chat** with random matching, text chat, preferences, optional accounts, and a moderation console.

**Stack:** Preact + Vite · Hono + `ws` · libSQL / Turso · TypeScript · WebRTC

| | |
|---|---|
| **App** | `/` — match, video, chat |
| **Admin** | `/admin` — reports, bans, metrics |
| **Locales** | English, Español, Português (UI + legal copy) |

---

## Quick start

```bash
npm install
cp .env.example .env   # optional for local defaults
npm run dev
```

| Service | URL |
|---------|-----|
| Vite SPA | http://localhost:5173 |
| API + WebSocket | http://localhost:8787 |

Open the SPA; it proxies API/WS to the backend in dev.

### Production (single process)

API, WebSocket, and the built SPA share one port:

```bash
npm run build
ADMIN_KEY=secret \
  CORS_ORIGINS=http://localhost:8787 \
  APP_URL=http://localhost:8787 \
  npm start
```

- App: http://localhost:8787  
- Admin: http://localhost:8787/admin  

### Docker

```bash
export ADMIN_KEY=your-long-secret
docker compose up --build
# with optional coturn profile:
# docker compose --profile turn up --build
```

---

## Features

- **Match filters** — country, language, gender, interests  
- **Call controls** — next stranger, mute/camera, device pickers, fullscreen, connection quality  
- **Auto find-next** after peer disconnect  
- **Ephemeral chat** (not stored server-side)  
- **Auth** — register / login, email verify, password reset, account delete  
- **Safety** — report, block, age gate (18+), rules / privacy / terms  
- **WebRTC** — TURN credentials API + STUN fallback  
- **Ops** — health live/ready, JSON + Prometheus metrics, graceful drain, admin CSV export  
- **i18n** — all user-facing strings via `src/i18n/` (`en` · `es` · `pt`)

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite + API watch |
| `npm run build` / `npm start` | Production SPA + server |
| `npm run check` | TypeScript project build |
| `npm test` | Unit tests |
| `npm run test:integration` | Live HTTP API tests |
| `npm run test:e2e` | Playwright end-to-end |
| `npm run test:all` | check + unit + integration + build + e2e |
| `npm run loadtest` | WebSocket matchmaking stress |
| `npm run smoke` | Post-deploy HTTP smoke |
| `npm run backup` | Local SQLite backup |

Make targets: `make dev`, `make build`, `make ci`, `make docker`, `make docker-turn`.

---

## Project layout

```
src/           Preact UI (components, hooks, i18n)
server/        Hono API, WebSocket matchmaking, auth, admin
shared/        Shared types & preference codes
deploy/        Caddy, nginx, systemd, k8s, coturn example
e2e/           Playwright specs
scripts/       backup, load-test, smoke
```

### Internationalization

User-visible copy lives in:

- `src/i18n/en.ts` — source of truth / `Messages` type  
- `src/i18n/es.ts`, `src/i18n/pt.ts` — translations  
- `src/i18n/index.ts` — `t()`, `detectLocale()`, label helpers  

**Do not hardcode UI strings** in components. Add a key to `en.ts` first, mirror it in `es`/`pt`, then use `t.key` (or helpers like `countryLabel`, `interestLabel`). Preference **codes** (`music`, `PE`, `en`) stay in `shared/types.ts`; **labels** stay in i18n.

Locale is stored as `stranger-locale` in `localStorage` and falls back to the browser language.

---

## Environment (highlights)

See [`.env.example`](./.env.example) and [DEPLOY.md](./DEPLOY.md).

| Variable | Purpose |
|----------|---------|
| `ADMIN_KEY` | Moderation console + private metrics |
| `CORS_ORIGINS` | Allowed browser origins (comma-separated) |
| `APP_URL` | Public URL (reset / verify links) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Hosted libSQL (preferred in prod) |
| `TURN_SECRET` / `TURN_URLS` | TURN REST credentials |
| `EMAIL_WEBHOOK_URL` | Password-reset / verify email delivery |
| `FEATURE_*` | Anonymous match, quality telemetry, require verified email, … |
| `SHUTDOWN_DRAIN_MS` | Graceful WebSocket drain on shutdown |

---

## Ops & deploy

| Doc / path | Contents |
|------------|----------|
| [DEPLOY.md](./DEPLOY.md) | Env, TLS, TURN, Turso, backups |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Dev workflow |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes |
| `deploy/Caddyfile`, `deploy/nginx.conf` | Reverse proxy |
| `deploy/turnserver.conf.example` | coturn |
| `deploy/systemd/stranger.service` | systemd unit |
| `deploy/k8s/` | Kubernetes sample |

---

## Safety

- **18+ only.** Age gate and registration enforce adulthood.  
- Video/audio are **not recorded** by default.  
- Report and block tools feed the admin console.  
- Brand carefully if you go public — this product is **stranger**, not a trademarked third-party service.

---

## License

Private / unlicensed unless you add a license file.

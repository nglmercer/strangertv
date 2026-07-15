# stranger — anonymous video chat

Random 1:1 video matching with WebRTC, text chat, preferences, auth, moderation, and ops tooling.

**Stack:** Preact + Vite · Hono + `ws` · libSQL/Turso · TypeScript

## Quick start

```bash
npm install
cp .env.example .env   # optional
npm run dev            # http://localhost:5173  + API :8787
```

Production (single port — API, WS, SPA):

```bash
npm run build
ADMIN_KEY=secret CORS_ORIGINS=http://localhost:8787 APP_URL=http://localhost:8787 npm start
# http://localhost:8787       app
# http://localhost:8787/admin moderation
```

Docker:

```bash
export ADMIN_KEY=your-secret
docker compose up --build
```

## Features

- Match filters: country, language, gender, interests  
- Next stranger, mute/camera, device pickers, connection quality  
- Auto-find-next after peer disconnect  
- Chat (ephemeral; not stored)  
- Sessions, password reset (webhook or dev log)  
- Report / ban / admin console  
- TURN credentials API, STUN fallback  
- Metrics JSON + Prometheus, live/ready health, graceful drain  

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite + API watch |
| `npm run build` / `npm start` | Production SPA + server |
| `npm test` | Unit tests |
| `npm run test:integration` | Live HTTP API tests |
| `npm run test:e2e` | Playwright |
| `npm run loadtest` | WS matchmaking stress |
| `npm run smoke` | Post-deploy HTTP smoke |
| `npm run backup` | Local SQLite backup |

## Ops docs

- [DEPLOY.md](./DEPLOY.md) — env, TLS, TURN, Turso, backups  
- `deploy/Caddyfile`, `deploy/nginx.conf` — reverse proxy  
- `deploy/turnserver.conf.example` — coturn  
- `deploy/systemd/stranger.service` — systemd unit  

## Environment (highlights)

See `.env.example`. Important:

- `ADMIN_KEY` — moderation + private metrics  
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`  
- `TURN_SECRET` / `TURN_URLS`  
- `EMAIL_WEBHOOK_URL` — password-reset mail  
- `FEATURE_ANONYMOUS_MATCH`, `FEATURE_QUALITY_TELEMETRY`  
- `SHUTDOWN_DRAIN_MS` — graceful WS drain  

## Safety

18+ only. Do not record video by default. Brand carefully if you go public (this is **stranger**, not a trademarked product).

## License

Private / unlicensed unless you add one.

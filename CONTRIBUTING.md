# Contributing

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

- App: http://localhost:5173  
- API: http://localhost:8787  
- Admin: http://localhost:5173/admin (or production single-port `/admin`) with `ADMIN_KEY`

## Checks before a PR

```bash
npm run check
npm test
npm run test:integration
npm run test:e2e   # needs Playwright browsers once: npx playwright install chromium
```

## Layout

| Path | Role |
|------|------|
| `src/` | Preact client |
| `rust/` | axum + WS + libSQL (the API server) |
| `shared/` | Types shared by client and server; `shared/generated/` is emitted from `rust/src/proto` by ts-rs — edit the Rust, not the output |
| `e2e/` | Playwright |
| `deploy/` | Caddy, nginx, k8s, coturn, systemd |

## Conventions

- TypeScript strict; no `any` unless unavoidable  
- Prefer small modules over growing `App.tsx` further  
- Do not log passwords, tokens, or media  
- 18+ product: keep age gates and report flows intact  

## Security

Never commit `.env`, production `ADMIN_KEY`, or Turso tokens.

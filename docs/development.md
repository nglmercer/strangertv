# Development

Day-to-day commands and conventions. Contributor workflow (setup, checks,
layout, security rules) lives in
[CONTRIBUTING.md](../CONTRIBUTING.md); release notes in
[CHANGELOG.md](../CHANGELOG.md).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite + API (cargo watch) |
| `npm run build:all` / `npm start` | Production SPA + server binary |
| `npm run check` | TypeScript project build |
| `npm run check:generated` | Fail if `shared/generated` is stale vs `rust/src/proto` |
| `npm run rust:test` | Rust unit + integration tests |
| `npm run migrate:auth` / `npm run migrate:auth-users` | Explicit Better Auth schema/user migration |
| `npm test` | Black-box HTTP/WS suites against the built binary |
| `npm run test:integration` | Live HTTP API tests only |
| `npm run test:e2e` | Playwright end-to-end |
| `npm run test:all` | check + generated + rust + build + suites + e2e |
| `npm run loadtest` | WebSocket matchmaking stress |
| `npm run smoke` | Post-deploy HTTP smoke |
| `npm run backup` | Local SQLite backup |

Make targets: `make dev`, `make build`, `make ci`, `make docker`,
`make docker-turn`. See [Makefile](../Makefile).

## Checks before a PR

```bash
npm run check
npm test
npm run test:integration
npm run test:e2e   # needs Playwright browsers once: npx playwright install chromium
```

Strict gate (also runs clippy with warnings denied):

```bash
make check
```

## Conventions

- TypeScript strict; no `any` unless unavoidable
- Prefer small modules over growing `App.tsx` further
- `shared/generated/` is emitted from `rust/src/proto` by ts-rs — edit the
  Rust, not the output (enforced by `check:generated`)
- Do not hardcode UI strings — see [Internationalization](./i18n.md)
- Do not log passwords, tokens, or media
- 18+ product: keep age gates and report flows intact

## Security

Never commit `.env`, production `ADMIN_KEY`, or Turso tokens.

Related: [Testing](./testing.md) · [Architecture](./architecture.md).

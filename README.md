# stranger

Anonymous 1:1 **live video chat** with random matching, text chat, preferences, optional accounts, and a moderation console.

**Stack:** Preact + Vite (TypeScript) · axum + tokio (Rust) · libSQL / Turso · WebRTC

| | |
|---|---|
| **App** | `/` — match, video, chat |
| **Admin** | `/admin` — reports, bans, metrics |
| **Locales** | English, Español, Português (UI + legal copy) |

---

## Documentation

| Article | Contents |
|---------|----------|
| [Getting started](./docs/getting-started.md) | Dev setup, URLs, production single-port, Docker |
| [Features](./docs/features.md) | Matching, calls, accounts, safety, platform |
| [Architecture](./docs/architecture.md) | Stack, request flow, project layout, data |
| [Development](./docs/development.md) | Scripts, Make targets, PR checks, conventions |
| [Configuration](./docs/configuration.md) | Full environment-variable reference |
| [Deployment](./docs/deployment.md) | Prod mode, Docker, reverse proxy, example configs |
| [Authentication](./docs/authentication.md) | Auth model, Google sign-in, Better Auth migration, rehearsal |
| [Operations](./docs/operations.md) | Health, metrics, admin, backups, load test & smoke |
| [WebRTC / TURN](./docs/webrtc.md) | Credentials API, coturn setup, STUN fallback |
| [Internationalization](./docs/i18n.md) | Locales, message keys, translation rules |
| [Testing](./docs/testing.md) | Unit, integration, black-box, e2e suites + CI |
| [Safety](./docs/safety.md) | 18+ policy, reporting, moderation tooling |
| [Roadmap](./docs/roadmap.md) | Product roadmap (phases, acceptance criteria) |
| [Auth migration plan](./docs/migration-plan.md) | Phased StrangerTV → better-auth-rs plan |
| [Contributing](./CONTRIBUTING.md) | Dev workflow, conventions, security |
| [Changelog](./CHANGELOG.md) | Release notes |

---

## Quick start

```bash
npm install
cp .env.example .env   # optional for local defaults
npm run dev
# if port 8787/5173 is already taken (EADDRINUSE):
npm run free-ports   # or: npm run dev:fresh
```

| Service | URL |
|---------|-----|
| Vite SPA | http://localhost:5173 |
| API + WebSocket | http://localhost:8787 |

Full setup: [Getting started](./docs/getting-started.md).

---

## Safety

- **18+ only.** Age gate and registration enforce adulthood.
- Video/audio are **not recorded** by default.
- Report and block tools feed the admin console.

Details: [Safety](./docs/safety.md).

---

## License

Private / unlicensed unless you add a license file.

# Changelog

## Unreleased

### Added
- Admin report status filter (open/resolved/all); peer-left reason messages
- ICE preload; Docker copies `public/`; `npm run test:all`
- Version read from package.json in production
- Admin avg ratings + open report counts; unique ratings per room/session
- Critical alerts for underage reports; long-wait queue tip
- robots.txt, security.txt, version in footer
- Call timer, keyboard shortcuts (M/C/N/Esc), post-call star rating
- Admin resolve report + rating API/table
- App `version` on `/api/health`, CONTRIBUTING + issue/PR templates
- Shared interest badges + peer country on match
- Session refresh (`POST /api/auth/refresh`), OpenAPI at `/api/docs`
- Request IDs (`X-Request-Id`), chat rate limits
- Error boundary, offline banner, web app manifest
- Mid-call block, DB block hydration, unblock in settings
- Email verification tokens (`?verify=`), resend, optional enforce flag
- Rematch cooldown (users/sessions) via `REMATCH_COOLDOWN_MS`
- Match sound + optional desktop notifications
- ICE restart / retry connection on failure
- Live/ready probes, Prometheus metrics, graceful drain
- Admin CSV export, report spike alerts
- Rate-limit headers on auth endpoints
- Docker HEALTHCHECK, k8s manifests, coturn compose profile
- GitHub Actions CI + Dependabot
- Makefile, smoke/backup/loadtest scripts

### Changed
- WebSocket stack uses `ws` + Hono `serve` (stable Node adapter)
- Single-port production: SPA + API + WS from Hono

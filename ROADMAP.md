# Stranger roadmap

## Foundation

- [x] Preact + Vite 8 video client
- [x] Hono WebSocket signaling and WebRTC negotiation
- [x] Country preference queue, multi-language UI, local session UX
- [x] Register/login API backed by libSQL or Turso
- [x] Signed, expiring Turso-backed sessions; rate limits; migrations
- [x] Node test coverage for matching and auth helpers

## Reliable video matching

- [x] TURN credential API (optional env) + multi-STUN
- [x] Queue heartbeats, next/leave, room IDs
- [x] Interests, language, gender, country match criteria
- [x] ICE candidate buffering and connection quality UI

## Safety and operations

- [x] Age gate, report flow, block API, ban tables, admin report list
- [x] Rules / safety / privacy / terms pages; no media recording by default
- [x] Vite proxy, health endpoint, CORS allowlist config
- [x] Admin moderation console + admin APIs
- [x] Metrics, structured logs, security headers
- [x] Password-reset email hook (webhook / dev log)
- [x] Docker compose + DEPLOY.md + load-test script
- [x] Playwright e2e (API, WS match, landing, admin auth)
- [x] CI workflow, README, proxy/TURN/systemd examples
- [x] Live/ready probes, Prometheus metrics, graceful WS drain
- [x] Auto-next, quality telemetry, feature flags, smoke/backup scripts
- [x] Mid-call block + DB block hydration
- [x] Email verification tokens + optional enforce flag
- [x] Drain reconnect, report alerts, admin CSV, k8s/Makefile/coturn compose
- [x] Settings blocks/unblock, rematch cooldown, ICE retry, match notify/sound
- [x] Rate-limit headers, Docker HEALTHCHECK, Dependabot, integration tests
- [x] Shared interests UI, session refresh, OpenAPI, request IDs, PWA manifest
- [x] Call timer, shortcuts, ratings, admin report resolve, versioned health
- [x] Rating uniqueness, underage alerts, long-wait UX, robots/security.txt
- [x] Admin report filters, peer-left reasons, ICE preload, Docker public assets
- [ ] Live HTTPS host + real TURN + Turso in your cloud account (ops only)


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
- [ ] Production HTTPS deployment, Turso backups, load testing, full Playwright e2e

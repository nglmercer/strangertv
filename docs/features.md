# Features

What the app (`/`) and the moderation console (`/admin`) do today.

## Matching & calls

- **Match filters** — country, language, gender, interests
- **Call controls** — next stranger, mute/camera, device pickers, fullscreen,
  connection quality
- **Auto find-next** after peer disconnect
- **Ephemeral chat** — messages are relayed, not stored server-side

Matching flow details: [Architecture](./architecture.md) ·
[WebRTC / TURN](./webrtc.md).

## Accounts & auth

- Register / login with an HttpOnly Better Auth cookie, temporary legacy
  Bearer token, email verify, dual-session password reset, and account delete
- Optional Google sign-in (appears only when configured)
- 18+ age gate on matching and registration

Full auth model: [Authentication](./authentication.md).

## Safety & moderation

- Report, block, age gate (18+), rules / privacy / terms pages
- Admin console: reports queue, bans, users, overview metrics, CSV export
- Report spike alerts and critical alerts for underage reports

Policy and tooling: [Safety](./safety.md) · [Operations](./operations.md).

## Platform

- **WebRTC** — TURN credentials API (`GET /api/v1/ice`) + STUN fallback
- **Ops** — health live/ready probes, JSON + Prometheus metrics, graceful
  drain, admin CSV export
- **i18n** — all user-facing strings via `src/i18n/` (`en` · `es` · `pt`)

See [Operations](./operations.md) and
[Internationalization](./i18n.md).

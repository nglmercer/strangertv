# Safety

Product safety rules and the moderation tooling that enforces them.

## Policy

- **18+ only.** Age gate and registration enforce adulthood.
- Video/audio are **not recorded** by default.
- Report and block tools feed the admin console.
- Brand carefully if you go public — this product is **stranger**, not a
  trademarked third-party service.

## Tooling

- Report reasons and block actions end the room immediately; duplicate-report
  prevention and throttling limit abuse.
- The admin console (`/admin`) triages the report queue, bans, and users —
  see [Operations](./operations.md).
- Underage reports raise critical alerts; report spikes post to
  `ALERT_WEBHOOK_URL` past `ALERT_REPORTS_THRESHOLD` — see
  [Configuration](./configuration.md).

Keep age gates and report flows intact when changing matching, auth, or room
lifecycle code.

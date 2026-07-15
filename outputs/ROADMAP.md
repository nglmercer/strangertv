# Anonymous Video Chat Roadmap

This roadmap evolves the current Vite 8 + Preact frontend and Hono/WebSocket backend into a production-ready random video chat product. The product should be positioned as an anonymous video chat service rather than copying Omegle branding or UI directly.

## 1. Target product flow

1. Visitor opens the landing page.
2. A start modal asks for camera/microphone permission, age confirmation, terms acceptance, language, country preference, and optional interests.
3. Visitor chooses either:
   - Quick match: any available person.
   - Filtered match: language, country, and interests.
4. The client joins the matchmaking WebSocket queue.
5. The server matches two compatible users and exchanges WebRTC signaling messages.
6. The video room provides mute, camera toggle, next, report, block, and leave controls.
7. After leaving, the user can rate the connection and immediately find another person.
8. Registered users can view preferences, blocked users, reports, account settings, and limited conversation history metadata.

## 2. Phase roadmap

### Phase 0 — Foundation and product rules

- Rename the product and establish visual identity.
- Add age-gate, terms, privacy policy, community guidelines, and consent language.
- Define supported countries, languages, interests, and matching rules.
- Decide whether anonymous users can match without registration.
- Add `.env.example` and document Turso, WebSocket, STUN, TURN, session, and rate-limit settings.
- Add a shared domain model package for `User`, `MatchPreferences`, `QueueEntry`, `Room`, `SignalMessage`, `Report`, and `Block`.

Acceptance criteria:

- A user cannot start matching without accepting the age and terms requirements.
- All match decisions are explainable from the selected preferences.
- No message, video, or audio is persisted by default.

### Phase 1 — Start modal and preferences selector

Build a reusable `StartMatchModal` with these steps:

- Age confirmation.
- Terms and privacy acceptance.
- Camera and microphone preview.
- Language selector.
- Country selector with `Any country` option.
- Interest chips with a maximum selection count.
- Optional account prompt: continue anonymously or sign in.
- Connection readiness check.

Frontend components:

- `Modal`
- `StepIndicator`
- `CountrySelect`
- `LanguageSelect`
- `InterestPicker`
- `MediaPermissionCheck`
- `MatchSummary`

Backend changes:

- Validate every preference server-side.
- Normalize country codes using ISO alpha-2 values.
- Normalize languages using BCP-47 tags.
- Reject unsupported or malformed preferences.

### Phase 2 — Real matchmaking and video rooms

- Replace the single waiting socket with a queue keyed by language, country, and interests.
- Store only ephemeral queue state in memory or Redis-compatible storage.
- Add a match timeout and queue cancellation.
- Add reconnect handling and room expiry.
- Add a room ID and short-lived room token.
- Use WebRTC with STUN and production TURN credentials.
- Handle offer, answer, ICE candidates, renegotiation, connection failure, and reconnect.
- Add device selection for camera and microphone.
- Add a pre-call preview and an in-call connection indicator.

WebSocket message contract:

```ts
type ClientMessage =
  | { type: 'queue:join'; preferences: MatchPreferences }
  | { type: 'queue:leave' }
  | { type: 'room:next' }
  | { type: 'room:leave' }
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'report'; reason: ReportReason }

type ServerMessage =
  | { type: 'queue:waiting'; position?: number }
  | { type: 'room:matched'; roomId: string; role: 'offerer' | 'answerer' }
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'room:peer-left' }
  | { type: 'error'; code: string; message: string }
```

### Phase 3 — Functional login and registration

Current registration/login endpoints should be completed with real session handling.

Backend:

- Keep password hashing with `scrypt` or Argon2id.
- Store users in Turso with unique normalized email addresses.
- Add sessions table with hashed refresh/session tokens, expiry, revocation, and device metadata.
- Use secure, HTTP-only, same-site cookies for browser sessions.
- Add CSRF protection for cookie-authenticated mutations.
- Add email verification state and password reset tokens.
- Add login rate limiting and account lockout/backoff.
- Never return password hashes or long-lived bearer tokens to the client.

Tables:

- `users`
- `sessions`
- `email_verification_tokens`
- `password_reset_tokens`
- `user_preferences`
- `blocks`
- `reports`
- `consents`

Frontend:

- Add `AuthModal` with login/register tabs.
- Add inline validation and server error messages.
- Add loading, success, expired-session, and logout states.
- Preserve anonymous matching when auth is skipped.
- Add account settings for language, country, interests, and privacy.

Acceptance criteria:

- A user can register, log in, refresh the page, and remain authenticated.
- Duplicate emails, invalid credentials, expired sessions, and rate limits have clear UI states.
- Password reset and email verification do not reveal whether an account exists.

### Phase 4 — i18n and localization

Use an i18n layer with message keys rather than inline strings. Recommended initial languages: English, Spanish, Portuguese, French, German, and Japanese.

- Add `src/i18n/index.ts` with locale detection and fallback to English.
- Store messages in `src/i18n/locales/{locale}.json`.
- Translate navigation, modal steps, validation, status, moderation, privacy, and error messages.
- Localize date/time and country names with `Intl.DisplayNames`.
- Make the language selector available before matching.
- Store the selected language for anonymous users in local storage and for signed-in users in Turso.
- Keep matching language and UI language separate.
- Add pseudo-locale testing to catch clipped and hard-coded strings.

Acceptance criteria:

- No visible user-facing string is hard-coded in components.
- Switching language updates the active screen without losing form state.
- Every supported locale has a fallback for every message key.

### Phase 5 — Safety, moderation, and trust

This is required for an open anonymous video product.

- Add prominent report and block actions.
- Add report reasons: nudity/sexual content, harassment, hate, spam/scam, underage concern, violence, and other.
- End the room immediately when a user blocks or reports another user.
- Add report throttling, duplicate-report prevention, and abuse detection.
- Add automated image/video safety review only where legally and technically appropriate; do not record by default.
- Add moderator dashboard with report queue, evidence metadata, user/session bans, and audit log.
- Add IP/device abuse controls with privacy review.
- Add emergency escalation and child-safety procedures.
- Add content warnings, age restrictions, and regional policy controls.

Do not store conversation media unless the product has explicit consent, a clear retention policy, legal review, and secure encrypted storage.

### Phase 6 — Admin and operations

- Admin authentication with role-based access control.
- Dashboard for online count, queue wait time, successful matches, disconnects, reports, and bans.
- Health checks for HTTP, WebSocket, Turso, and TURN availability.
- Structured logs with request IDs and room IDs, excluding message contents and secrets.
- Metrics for queue latency, WebRTC failure rate, ICE failure rate, and reconnect rate.
- Feature flags for new matching filters and locales.
- Database migrations and backups for Turso.

### Phase 7 — Testing and quality

Recommended stack:

- Vitest for unit and server tests.
- Testing Library for Preact components.
- `happy-dom` for lightweight DOM tests.
- Playwright for browser flows.
- `tsc -b` for strict type checking.
- Coverage in CI with a sensible threshold, beginning at 80% for backend matching/auth logic.

Test suites:

- Matching preference compatibility and country/language filtering.
- Queue join, leave, timeout, and reconnect behavior.
- WebSocket message validation and unauthorized messages.
- Registration, login, sessions, reset, and rate limits.
- i18n key completeness and locale switching.
- Modal validation and permission denial states.
- Two-browser WebRTC signaling with mocked media devices.
- Report/block behavior and room teardown.
- Accessibility keyboard navigation and screen-reader labels.
- Production build and migration smoke tests.

### Phase 8 — Production deployment

- Deploy the Hono server over HTTPS/WSS.
- Configure a managed TURN service; STUN alone will not work for every network.
- Configure Turso production database and separate staging database.
- Add secrets through the deployment platform, never committed `.env` files.
- Add CORS allowlist for production origins.
- Add secure cookies, CSP, HSTS, frame restrictions, and rate limits.
- Add graceful shutdown for WebSocket rooms.
- Load-test queue matching and WebSocket fan-out.
- Run a staged release with internal testers before public launch.

## 3. Recommended implementation order

1. Start modal, terms/age gate, and media permission flow.
2. Shared types and validated preference model.
3. WebSocket queue with language/country/interest matching.
4. WebRTC room lifecycle, reconnect, next, leave, and TURN support.
5. Turso sessions and complete auth UI.
6. i18n foundation and initial locales.
7. Report/block/moderation flows.
8. Vitest, Testing Library, and Playwright coverage.
9. Admin operations, observability, load testing, and production hardening.

## 4. Definition of done

- Anonymous and authenticated users can safely start a filtered video match.
- Country, language, and interest filters work server-side and are covered by tests.
- Login, registration, logout, sessions, verification, and reset work end-to-end.
- WebRTC works across common network types with TURN configured.
- Every user-facing flow is translated for the supported locales.
- Report/block actions terminate the room and reach moderators.
- No secrets, passwords, or media are accidentally logged or persisted.
- CI passes type checking, unit tests, browser tests, build, and migration checks.

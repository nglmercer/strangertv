# Activities

Embeddable minigames that launch from a group chat, in the style of Discord
Activities: the game runs isolated in an iframe and logs in with a
user-info-only identity — it never sees the user's session.

## How it works

1. A group member opens the game controller in the chat header, picks a game
   from the catalog (or joins a live one), and the host app calls
   `POST /api/v1/activities/instances/{id}/join` with the full session. The
   response is a **single-use launch code** (5-minute TTL).
2. The host renders the game URL (e.g. `/activities/tictactoe`) in a
   sandboxed same-origin iframe and hands it the code over `postMessage`
   after the game announces `activity:ready`.
3. The game exchanges the code for an **instance token** at
   `POST /api/v1/activities/instances/{id}/token` with `credentials: 'omit'`,
   then reads its scoped identity (`id`, `username`, `displayName` — nothing
   else) from `GET /api/v1/activities/me` with that token.
4. Moves travel game → host (`postMessage`) → server (`activity:state` over
   the app WebSocket) → each player's host → game. Presence, launch, and end
   events fan out to group members the same way.

## Trust boundaries

- **Two credential realms.** Session endpoints resolve the cookie/Bearer
  session; game endpoints (`/token`, `/activities/me`) resolve ONLY the
  `activity_tokens` table. A session credential proves nothing to the game
  API and vice versa, by table separation — covered by
  `session_tokens_never_resolve_as_instance_tokens` and the integration
  suite's scoping checks.
- **Codes are single-use and instance-bound.** Replaying a code, or using it
  against another instance, fails closed with a generic message. The host
  mints one code per `ready` (a retry looks exactly like a reload), so
  several may be outstanding; each is single-use and expiry sweeps them.
- **Framing is scoped.** The global `X-Frame-Options: DENY` /
  `frame-ancestors 'none'` policy carves out exactly `/activities/*` game
  pages (`SAMEORIGIN` / `'self'`); the API paths underneath `/api/v1/…`
  stay unframble. See `rust/src/infra/security.rs`.
- **postMessage is origin- and source-checked** on both ends
  (`src/activities/client.ts`); malformed frames are ignored, mirroring the
  WS handlers.
- **State relay is capped**: 16 KB per payload, 60/min per player+instance,
  and only active participants may publish. Presence/launch/end events go to
  all group members (they can all open the launcher anyway).

## Limits (v1)

- First-party games only: the catalog is seeded in `db.rs` and games ship in
  this repo under `src/activities/`. Third-party URL registration is a
  future step behind an allowlist + sandbox review.
- 3 active games per group; seats bounded by each game's `max_players`.
- Launch surface is group chat; DMs reuse the same instance model later.
- Ending is host- or group-admin-only; the last seat out ends the game and
  revokes its tokens immediately.

## Building a game

1. Add the pure rules under `src/activities/<slug>/` with a vitest suite
   (see `tictactoe/logic.ts`).
2. Build the component on `createActivityGuest()` from
   `src/activities/client.ts`: retry `ready()` until the first `onInit`
   (the first one can predate the host's listener), then
   `exchangeLaunchCode` → `fetchActivityMe`, then `publish` moves and apply
   `onState` updates. Take the first init and validate every inbound
   update — the host relays, it does not referee.
3. Register the slug in `ActivityGame.tsx` and seed the catalog row in
   `rust/src/db.rs` (`INSERT OR IGNORE INTO activities …`).
4. Game-defined state is opaque JSON to the server; keep snapshots small
   and make remote updates idempotent (turn-based games converge on
   legal-move checks, as tic-tac-toe does).

Contract details: [Architecture](./architecture.md) ·
API reference: `/api/v1/docs` · Wire types: `shared/generated/`.

## In-call parties

The call bar's more menu (⋯) offers **Activities** during a matched call
(signed-in host only). Picking a game provisions one party group for the
call — named `Game with <peer>` with every authenticated peer as a member —
launches the instance there, and sends `activity:invite` over the match
socket. Each other call participant gets a join prompt; accepting joins the
instance and opens the same iframe session, declining just dismisses it.

- `src/hooks/useCallParty.ts` — party state: lazy group provisioning,
  launch + auto-invite, invite prompt, auto-join on accept, seat give-back
  when the call ends;
- `src/components/social/ActivityInviteModal.tsx` — the peer-side prompt
  (anonymous receivers get a sign-in hint; seats need an account);
- the launcher and session views are the shared `ActivityLauncher` /
  `ActivitySession` from group chat.

Server side, `activity:invite` is validated like any other relay: the
sender must be authenticated, currently in the claimed room, and seated at
an active instance. Targets are sockets, not users, so 1:1 partners and
group rooms both work — covered by `tests/activity-invite.test.ts`.

Limits: one party group per call (reused across launches), anonymous peers
cannot play until they sign in, and the party group stays behind as a
regular group after the call — delete-or-archive for parties is future work.

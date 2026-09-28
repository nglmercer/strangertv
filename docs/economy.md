# Points economy

Authenticated-users-only points. No real money moves: points reward
participation and good behavior, and matchmaking consumes them. Guests never
hold or spend points — the matchmaking gate rejects them before any charge.

## Rules (v1, tunable in `rust/src/constants.rs`)

| Event | Delta |
|---|---|
| Signup grant (new accounts + one-time backfill) | +100 |
| Daily login reward (automatic, 1/day UTC) | +50 |
| Solo `queue:join` / `room:next` attempt | −5 |
| Group-match create (both entry points) | −5 |
| Ad claim | +10, 60s cooldown, 50/day cap (UTC) |
| Gift received / sent | +N / −N |
| Admin adjustment | ±N, no floor (penalties bite through zero) |

A broke user gets `insufficient_funds` on join and is not charged; `room:next`
costs the same as a fresh join (it is a new search, and the cost is the
queue-spam lever).

## How it works

- `point_ledger` is the append-only audit trail
  (`user_id, delta, reason, ref_id, note, created_at`); `users.points_balance`
  is a cache updated in the same transaction. All mutations live in
  `rust/src/domain/economy.rs`, which the HTTP routes and the WebSocket
  `charge_match` helper share.
- Spends debit through a conditional `UPDATE ... WHERE balance >= cost`, so
  concurrent joins cannot overdraw.
- HTTP: `GET /api/v1/economy/me` (balance + recent), `GET
  /api/v1/economy/leaderboard` (top 50, usernames only), `POST
  /api/v1/economy/ads/claim`, `POST /api/v1/economy/gift`, and `POST
  /api/v1/admin/economy/adjust` behind `x-admin-key`.
- Penalties are manual admin adjustments with a required note, decided from
  the report queue. Automatic report deductions are deliberately out of scope:
  they would let false reports drain victims.
- Ad claims are server-capped attestations; the client shows a short
  placeholder view before claiming. Clocks and caps come from SQLite, so
  farming is bounded. A real ad-provider SDK is future work.
- The daily reward credits automatically on the first session establishment
  of the UTC day (register, login, token refresh, or `GET /auth/me`, which
  the client calls on every boot). The grant is a guarded single-statement
  `INSERT`, so concurrent logins cannot double-claim; failures are logged
  and never fail auth. Registration day counts: a new account gets the
  signup grant plus that day's reward.

## Client

Balance in the Account modal (logged-in users), `EconomyPanel` for
earn/gift/leaderboard/history, and an insufficient-funds hook in
`useMatchSession` that opens the panel. The panel persists `nextClaimAt`
from grant responses for its cooldown countdown; a granted daily reward
shows a toast on boot (`dailyGranted` on `GET /auth/me`).

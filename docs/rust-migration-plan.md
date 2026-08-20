# Backend migration: TypeScript → Rust

Branch: `rust-backend`

> **Status: phases 0–8 complete.** The Rust server passes the full existing
> suite — 58/58 vitest and 11/11 Playwright — and is what `npm start` and the
> container now run. The Node server is untouched under `server/` and remains
> the rollback path. What follows is the plan as written; the outcome of each
> phase, and where reality differed, is recorded in §9.

## 1. Scope

**Moves to Rust** — everything under `server/` (~4,600 LOC, 24 files):

| Area | Files | LOC |
|---|---|---|
| Matchmaking engine | `matchmaking/{core,state,sockets,types}.ts` | ~1,100 |
| WebSocket protocol | `ws/handlers.ts` | 807 |
| HTTP routes | `routes/{auth,social,groups,admin,misc,health}.ts` | ~950 |
| Domain services | `friends.ts`, `groups.ts`, `messages.ts`, `presence.ts`, `auth.ts` | ~1,000 |
| Infrastructure | `db.ts`, `config.ts`, `logger.ts`, `metrics.ts`, `rateLimit.ts`, `security.ts`, `static.ts`, `email.ts`, `turn.ts`, `http.ts`, `requestId.ts`, `alerts.ts`, `openapi.ts` | ~750 |

**Stays TypeScript**: `src/` (Preact frontend), `e2e/`, Vite build, `shared/` (see §2).

**Not in scope**: behaviour changes. This is a port. Every deviation from current
behaviour is a bug until the parity suite says otherwise.

## 2. The `shared/` problem — decide this first

`shared/` (~950 LOC: `types.ts`, `constants.ts`, `json.ts`, `age.ts`) is imported by
**both** `src/` and `server/`. It is the wire contract: route paths, WS message
tagged unions, report reasons, defaults. Today TypeScript enforces client/server
agreement at compile time. A Rust server deletes that guarantee — this is the single
largest risk in the migration, and it is a design decision, not an implementation
detail.

Three options:

| Option | How | Cost | Drift risk |
|---|---|---|---|
| **A. Generate TS from Rust** (recommended) | Rust structs/enums are the source of truth; `ts-rs` derives emit `shared/generated/*.ts` at build time | ~1 day setup, CI check that generated output is committed and current | Near zero — a Rust change that breaks the client fails `tsc` |
| B. Hand-mirror | Keep `shared/` as-is; write Rust types by hand to match | Cheapest to start | High — silently diverges on the first schema change |
| C. Schema-first | Define the contract in OpenAPI/JSON-Schema, generate both sides | Most rigorous | Near zero, but heaviest tooling |

**Recommendation: A.** `ClientMessage`/`ServerMessage` are discriminated unions on
`type`, which maps exactly onto `#[derive(Serialize, TS)] #[serde(tag = "type")]`
Rust enums. `constants.ts` keeps its route-path helpers hand-written on the TS side
(they are pure client concerns), but every payload shape gets generated.

Do this in Phase 1, before any route work. Retrofitting it later means rewriting
every type twice.

## 3. Target stack

| Concern | Crate | Why this one |
|---|---|---|
| HTTP + WS | `axum` 0.8 + `tokio` | One server for both, as today. `tower` layers map 1:1 onto the Hono middleware chain. |
| Database | `libsql` | Official Turso Rust client. Same `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`, same `file:` local mode — **no data migration, no schema change**. |
| Serialization | `serde` + `serde_json` | `#[serde(tag = "type")]` reproduces the WS unions exactly. |
| Shared state | `tokio::sync::RwLock` + `HashMap`, or `dashmap` | Replaces the module-level `Map`s in `matchmaking/state.ts`. |
| Password hashing | `scrypt` | **Must reproduce Node's exact parameters** — see §7. |
| Hashing / tokens | `sha2`, `hmac`, `sha1`, `base64`, `rand` | Session tokens, token hashes, TURN REST credentials. |
| Logging | `tracing` + `tracing-subscriber` (JSON) | Matches `logger.ts` structured output; keeps log pipelines working. |
| Middleware | `tower-http` | `CompressionLayer`, `CorsLayer`, `ServeDir` replace `hono/compress`, `hono/cors`, `static.ts`. |
| Email | `lettre` (SMTP) + `reqwest` (webhook) | Both existing modes in `email.ts`. |
| Config | `std::env` + a small typed struct | `config.ts` is 42 lines; a config crate is overkill. |

Layout:

```
rust/
├── Cargo.toml
└── src/
    ├── main.rs            # server/index.ts — wiring, shutdown, WS accept loop
    ├── config.rs          # config.ts
    ├── db.rs              # db.ts + migrate()
    ├── error.rs           # unified AppError → HTTP status + WS error frame
    ├── proto/             # generated-from-here wire types (ts-rs)
    │   ├── client.rs      # ClientMessage
    │   └── server.rs      # ServerMessage
    ├── infra/             # logger, metrics, rate_limit, security, request_id, static, alerts, http
    ├── auth/              # auth.ts (hashing, sessions, tokens)
    ├── domain/            # friends, groups, messages, presence
    ├── matchmaking/       # state, sockets, core
    ├── ws/                # handlers.ts
    └── routes/            # auth, social, groups, admin, misc, health
```

## 4. Strategy: rewrite on a branch, single cutover

A strangler-fig migration (proxy some routes to Rust, some to Node) **does not work
here** without extra infrastructure, and it is worth being explicit about why:

- All matchmaking state — queues, rooms, socket registry, blocked pairs — lives in
  **process memory** (`matchmaking/state.ts`). Two processes cannot both own it.
- The HTTP routes are not cleanly stateless either: `registerSocialRoutes(app, send)`
  and `registerGroupsRoutes(app, send)` are handed the WS `send` function and push
  notifications into live sockets. They are coupled to the same in-memory state.

Splitting would mean first externalizing state to Redis — a larger, riskier project
than the port itself, and pure throwaway work.

So: **build the full Rust server on this branch, validate with the existing
black-box suite, cut over in one deploy.** Keep the Node server runnable on `main`
for the whole period as the rollback path.

The phase order below is still "stateless first" — not to ship incrementally, but
because it front-loads the parts that are easy to verify and defers the hard
stateful core until the infrastructure under it is proven.

## 5. Phases

Each phase ends with a green check; do not start the next until it passes.

### Phase 0 — Harness (½ day)
Make the existing tests able to target either server. `tests/api.integration.test.ts`,
`group-invite`, `invitation`, `presence` all `spawn('npx', ['tsx', 'server/index.ts'])`.
Replace with a `spawnServer()` helper reading `SERVER_CMD` (default: current tsx
command). **Exit:** whole suite green against Node, unchanged behaviour.

### Phase 1 — Skeleton + wire contract (2 days)
Cargo project, `config.rs`, `tracing` JSON logger, `main.rs` serving `/api/v1/health/live`.
Define `proto/` enums for `ClientMessage`/`ServerMessage`, wire `ts-rs` generation
into the build, and point `src/` at the generated types. **Exit:** `tsc -b` clean
against generated types; `/health/live` responds; CI fails if generated TS is stale.

### Phase 2 — Data + auth primitives (2 days)
`db.rs` with `migrate()` (port the DDL verbatim — same tables, same defaults),
`auth/` with scrypt/session/token functions. Port `tests/auth.test.ts` and
`tests/config.test.ts` as Rust unit tests. **Exit:** Rust binary opens the *existing*
`local.db` and authenticates a user created by the Node server. This is the
compatibility proof — do not proceed without it.

### Phase 3 — Stateless HTTP (3 days)
`health`, `misc` (config/public, ice, openapi), `admin`, `auth` routes. Middleware
stack: request-id → security headers → compression → CORS → rate limit. Static file
serving. **Exit:** `api.integration.test.ts` green against `SERVER_CMD=rust`.

### Phase 4 — Domain services (4 days)
`friends`, `messages`, `groups`, blocks/reports/ratings. Port `tests/blocks.test.ts`
and `tests/messages.test.ts` to Rust. **Exit:** Rust unit tests green; social/groups
route handlers compile against real service functions (notifications stubbed).

### Phase 5 — Matchmaking core (5 days — the hard one)
`state`, `sockets`, `core`. The 991-line `core.ts` is the densest logic in the
codebase: compatibility scoring, recent-pair cooldown, solo↔group merging, group
pair scoring, shared-interest computation. Port function by function, keeping names
and structure so the two versions can be diffed by eye during review. Port
`tests/matchmaking.test.ts`. **Exit:** Rust unit tests green.

### Phase 6 — WebSocket protocol (4 days)
`ws/handlers.rs` (807 lines), presence announce/offline, socket registry lifecycle,
the `send`-into-sockets path that social/groups routes depend on (un-stub Phase 4).
**Exit:** `presence.test.ts`, `invitation.test.ts`, `group-invite.test.ts` green
against the Rust binary — ~1,000 lines of black-box WS tests, the real acceptance gate.

### Phase 7 — Parity + hardening (3 days)
Full suite: `test:all` + Playwright e2e against Rust. Graceful shutdown with the
drain broadcast. Load test (`scripts/load-test.mjs`) against both, compare match
latency and memory. Metrics/Prometheus output diffed field by field.
**Exit:** every existing test green; load-test numbers no worse than Node.

### Phase 8 — Deploy + cutover (2 days)
Multi-stage `Dockerfile` (`rust:alpine` builder → `scratch`/`distroless` runtime;
the Vite build stays a Node stage). Update `deploy/systemd`, `deploy/k8s`, the
`HEALTHCHECK` (drop the `node -e` fetch for a static binary equivalent),
`package.json` scripts, `Makefile`. **Exit:** staged deploy healthy; then cut over.

**Total: ~25 working days / 5 weeks** for one developer fluent in Rust. Add 40–60%
if Rust async is new — Phases 5 and 6 are where that cost lands.

## 6. Test strategy

The existing suite splits cleanly, and this is the migration's biggest asset:

**Black-box — keep as-is, they become the parity harness (~1,350 LOC):**
`api.integration.test.ts` (341), `group-invite.test.ts` (591), `invitation.test.ts`
(294), `presence.test.ts` (124), plus `e2e/auth-and-match.spec.ts`. These spawn the
server as a subprocess and drive it over HTTP/WS — they neither know nor care what
language it is written in. Only the spawn command changes (Phase 0).

**White-box — rewrite as Rust `#[cfg(test)]` (~250 LOC):**
`auth.test.ts`, `blocks.test.ts`, `config.test.ts`, `matchmaking.test.ts`,
`messages.test.ts`. These import server modules directly and cannot survive.

Net: ~85% of test coverage transfers for free. Run the black-box suite against
*both* servers in CI throughout the migration — that is what turns "it compiles"
into "it behaves identically".

## 7. Risks and known gotchas

**Password hash compatibility (highest risk).** `auth.ts` stores `${salt}:${keyHex}`
where `salt = randomBytes(16).toString('hex')` and the key is
`crypto.scrypt(password, salt, 64)`. Two traps:
1. Node's default scrypt params are N=16384, r=8, p=1 → the `scrypt` crate needs
   `log_n = 14, r = 8, p = 1`, 64-byte output.
2. Node passes the salt as the **hex string's ASCII bytes**, not the decoded 16 bytes.
   Rust must salt with `salt_str.as_bytes()`. Getting this wrong locks out every
   existing user with no error message — just failed logins.

Write a round-trip test against a hash generated by the Node server before writing
anything else in Phase 2.

**Other items:**
- **`process.uptime()` / `memoryUsage().rss`** in `metrics.ts` — needs a Rust
  equivalent (`std::time::Instant` at boot; `/proc/self/statm` or the `sysinfo` crate)
  or the Prometheus output changes shape and breaks dashboards.
- **Middleware ordering** — `tower` layers apply bottom-up, Hono's `app.use` applies
  top-down. Mechanical, but easy to invert `securityHeaders` vs `compress` and get
  unheadered responses.
- **`setInterval(...).unref()`** in `rateLimit.ts` → a `tokio::spawn` loop that must
  not hold shutdown open.
- **WS backpressure** — `ws.send()` in Node buffers unboundedly; axum's split sink
  must decide explicitly what happens to a slow client (drop vs. disconnect).
- **Number types** — SQLite integers arrive as JS `number`; Rust will use `i64`.
  Audit every `Number(row.x)` for places that tolerate `null`/`undefined` today.
- **`db.execute` argument binding** — the libsql Rust API differs enough from the JS
  client that positional args need care; no automatic `undefined` → `NULL`.
- **CORS credentials** — the current origin callback echoes the request origin. The
  `tower-http` equivalent must preserve that exactly or cookies break.
- **Flaky parity harness** — the integration suites each spawn a real server on a
  fixed port, and running the files in parallel made them contend badly (~1 in 6
  full runs green). Fixed in Phase 0 by `fileParallelism: false`. Keep watching
  this: a flaky gate cannot validate a port.

## 8. What the migration buys

Be honest about this before committing five weeks:

- **Memory and density** — a Rust matchmaking server should hold far more concurrent
  WS connections per instance than Node. If the current server is connection-bound,
  this is the real win.
- **Latency tail** — no GC pauses in the match loop.
- **Deploy size** — a static binary in `scratch` vs. `node:22-alpine` + `node_modules`
  + `tsx` transpiling at runtime (the current `CMD` is `npx tsx server/index.ts`,
  which compiles TypeScript on every boot).
- **Type safety at the state layer** — the in-memory maps are currently `Map<string, …>`
  with `as unknown as SocketLike` casts in several places; Rust's ownership model
  removes a class of socket-lifetime bugs.

It does **not** buy correctness for free, and it costs the compile-time
client/server contract unless §2 Option A is implemented.

## 9. Outcome

### What shipped

| Phase | Result |
|---|---|
| 0 — harness | `tests/helpers/server.ts`, `SERVER_CMD` selects the binary |
| 1 — skeleton + contract | `rust/src/proto` → `shared/generated` via ts-rs; `tsc` validates it |
| 2 — data + auth | Opens a Node-written database and authenticates a user it did not create |
| 3 — stateless HTTP | health, misc, admin, auth, middleware, static |
| 4 — domain services | friends, messages, groups + social/group routes; `api.integration` green |
| 5 — matchmaking | queue, 1:1, group lobbies, merging, cooldown, purge |
| 6 — WebSocket | full protocol + presence; all WS suites green |
| 7 — parity | e2e green, clippy clean, Prometheus diff clean, load compared |
| 8 — deploy | multi-stage image, systemd, k8s, scripts |

Measured at 120 concurrent WebSocket clients (release build): identical
behaviour — 20 pairs, 20 waiting, 80 errors, 1.60 matches/sec on both servers —
at **13.8 MB RSS versus Node's 99.5 MB**. The estimate of ~25 working days was
for a human; the phases themselves held up as written.

### Where the plan was wrong

**Phase 3's exit criterion was unreachable.** It named `api.integration.test.ts`,
but that suite also drives friends, messages, follows and groups, so it could
only go green at the end of Phase 4. The phase ordering was still right; only
the gate was misplaced.

**The `.db` files were already gitignored**, not committed as §7 claimed.

**The e2e suite was broken before the migration started** and had to be repaired
before it could gate anything — see below.

### What the port exposed in the existing code

None of these were caused by the migration; the port surfaced them.

1. **Unversioned API paths, in three places.** Three vitest suites polled
   `/api/health/live`, the Playwright `webServer` probe used the same path, and
   8 of 11 e2e tests called `/api/*` routes. No handler serves those — they fall
   through to the SPA handler and return `index.html` with a 200. The tests were
   asserting on HTML; the readiness probes were confirming only that a socket
   was listening.

2. **The same bug in the Kubernetes manifest.** `readinessProbe` and
   `livenessProbe` both used unversioned paths, so a pod with a dead API would
   have reported healthy indefinitely. This one was live in production config.

3. **A stale e2e assertion** on a `.brand` element deleted from the UI in
   `7179f2d` (2026-07-16).

4. **A flaky parity harness.** The integration suites each spawn a real server
   on a fixed port; run in parallel they passed roughly 1 full run in 6. Pinned
   to `fileParallelism: false`.

5. **Two default sets that look interchangeable and are not.**
   `shared/constants.ts` `DEFAULT_GENDER`/`COUNTRY`/`LANGUAGE` are all `"any"`
   and are what the API returns; `DB_DEFAULTS` (`other`/`any`/`en`) are SQL
   column defaults. Using one for the other changes the registration response.

6. **Dead code carried in the TypeScript**: `getPendingFriendRequests` was
   exported and never called. Removed.

7. **Test databases accumulating in the repo root.** The suites wrote
   `invitation_*.db` and friends next to the source; being gitignored, they just
   piled up (141 of them). They now go to the OS temp directory.

8. **The app version depended on the working directory.** `resolveVersion()`
   read `package.json` relative to `process.cwd()`, so the API reported `0.0.0`
   whenever it was started from anywhere but the repo root — which the Rust dev
   loop does. The Rust build bakes the version in at compile time, with a test
   asserting `Cargo.toml` and `package.json` still agree.

### The recurring hazard: strict parsing

JavaScript ignores unexpected and missing fields; serde rejects the frame. Every
field the server declares but does not read is a latent break. Three instances,
each of which silently dropped messages until fixed:

- `invitation:accept.roomId` and `group-match:invite.roomId` — declared
  required, sent by the app, never read by the server. Now optional.
- **`queue:join.preferences`** — the browser sends a *partial* object and lets
  `normalizePreferences` fill the rest. A strictly-typed field meant the frame
  was dropped and no match ever happened. The four preference-carrying variants
  now take raw JSON and normalize it, with `#[ts(as = "MatchPreferences")]`
  keeping the generated TypeScript precise.

The general rule for the rest of the port: **be strict about what you read, and
tolerant about what you accept**, exactly where the JavaScript was.

### Notes for whoever runs this next

- `npm start` and `npm run dev` now run the Rust binary. `npm run dev:node`
  still runs the TypeScript server for comparison.
- `npm run check:generated` fails if `shared/generated` is stale.
- `SERVER_CMD` / `E2E_SERVER_CMD` point the suites at either server; keep
  running both until the Node server is deleted.
- `npm run dev` hot-reloads via cargo-watch (`cargo install cargo-watch` if it
  is missing); `npm run dev:once` skips the watcher.
- The container healthcheck is `stranger-server --healthcheck`, so the runtime
  image needs neither curl nor node.

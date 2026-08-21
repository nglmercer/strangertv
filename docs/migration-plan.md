Yes. I’d structure this as a **multi-agent / multi-PR migration plan**, so an LLM can implement each phase independently without trying to rewrite StrangerTV auth in one pass.

# StrangerTV → better-auth-rs Migration Plan

## Mission

Migrate StrangerTV authentication to `better-auth-rs` while preserving:

* existing StrangerTV numeric `users.id`
* existing user passwords without forcing resets
* current business/profile/social tables
* current bearer sessions during a transition period
* existing signup business rules
* password-reset/session-revocation security
* rollback capability

Target Better Auth revision:

```text
nglmercer/better-auth-rs
commit: aa0117e49d30ff69d1ed36c74df27193c062f2de
```

Do **not** track Better Auth `main` during the migration. Pin the submodule.

---

# Global implementation rules for every LLM

Give these instructions to every coding agent:

```text
You are migrating StrangerTV authentication from its custom Rust auth
implementation to better-auth-rs.

Do not perform a big-bang rewrite.

Preserve StrangerTV's existing numeric users.id as the canonical
application identity.

For Better Auth users, encode the same numeric ID as a string:

    StrangerTV users.id = 42
    Better Auth user.id = "42"

Do not migrate or rewrite social/business foreign keys.

Do not expose Better Auth's stock signup endpoint directly to users.
StrangerTV must continue to enforce its own signup/profile/age/consent
business rules.

Do not delete legacy password hashes or the legacy session system until
the migration has been fully validated and the rollback period has ended.

Do not automatically run auth schema migrations when the application
starts. Migrations must be explicit deployment operations.

Use better-auth-rs pinned at:
aa0117e49d30ff69d1ed36c74df27193c062f2de

For the Rust dependency use only the required features:

    default-features = false
    features = ["axum", "libsql"]

Every migration PR must:
- include tests
- preserve existing auth behavior unless the phase explicitly changes it
- be independently deployable
- have a rollback strategy
- not silently migrate production data at startup
```

---

# Phase 0 — Better Auth final migration helpers

**Repository:** `better-auth-rs`

This can happen in parallel with StrangerTV Phase 1.

### Goal

Make bulk migration safe to restart and make future StrangerTV-created users able to preserve numeric IDs.

### Task 0.1 — Idempotent credential import

Extend:

```rust
CredentialService
```

with a migration-safe API such as:

```rust
pub async fn import_if_missing(
    &self,
    credential: ImportCredential,
) -> Result<ImportOutcome>
```

Suggested result:

```rust
pub enum ImportOutcome {
    Imported(User),
    AlreadyImported(User),
}
```

Required semantics:

```text
new email + new id
    => import

existing email + same id
    => AlreadyImported

existing id + same email
    => AlreadyImported

existing email + different id
    => conflict/error

existing id + different email
    => conflict/error
```

Never overwrite an existing password hash implicitly.

### Task 0.2 — Explicit-ID credential creation

Add a normal plaintext-password creation API where the caller may provide an ID:

```rust
pub struct CreateCredentialInput {
    pub id: Option<String>,
    pub email: String,
    pub name: String,
    pub password: String,
    pub email_verified: bool,
    pub additional_fields: Map<String, Value>,
}
```

If `id == None`, generate UUID as today.

If StrangerTV provides:

```rust
id: Some("42".into())
```

Better Auth must use `"42"`.

### Tests

Test:

* import with existing same ID/email is safe
* conflicting email is rejected
* conflicting ID is rejected
* supplied legacy hash remains byte-for-byte unchanged
* explicit ID credential creation stores requested ID
* normal UUID behavior remains available

These improvements are useful, but StrangerTV work does **not** need to wait for them because its migration command can implement its own pre-import existence checks initially.

---

# Phase 1 — Pin Better Auth in StrangerTV

**Repository:** `strangertv`

### Goal

Introduce the library without changing runtime authentication.

### Changes

Add:

```text
rust/vendor/better-auth-rs
```

as a git submodule pinned to:

```text
aa0117e49d30ff69d1ed36c74df27193c062f2de
```

Add dependency:

```toml
better-auth = {
    path = "vendor/better-auth-rs/crates/better-auth",
    default-features = false,
    features = ["axum", "libsql"]
}
```

Update CI checkout:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
```

Update Docker/build scripts so the submodule is present in build context.

### Acceptance criteria

```bash
cargo check
cargo test
```

work without changing StrangerTV's existing auth behavior.

No Better Auth tables need to exist yet.

---

# Phase 2 — Better Auth infrastructure

### Goal

Instantiate Better Auth using StrangerTV's existing Turso/libSQL database.

Do not route requests through it yet.

Create something similar to:

```text
rust/src/auth/better_auth.rs
```

Suggested structure:

```rust
pub struct BetterAuthState {
    pub context: AuthContext,
    pub credentials: CredentialService,
    pub sessions: SessionService,
}
```

Use the existing database configuration:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

Construct:

```rust
LibSqlDbAdapter::remote(...)
```

For local development:

```rust
LibSqlDbAdapter::local(...)
```

Configure:

```rust
AuthContext::builder(options)
    .database(adapter)
    .secondary_storage(...)
    .password_provider(...)
    .build()
```

Set Better Auth session lifetime to StrangerTV's current:

```text
14 days
```

### Critical rule

Application startup must **not** call:

```rust
apply_migrations(...)
```

automatically.

---

# Phase 3 — Explicit auth migration command

### Goal

Provide a deployment command that creates Better Auth tables.

Create something such as:

```text
cargo run --bin migrate-auth
```

or integrate into StrangerTV's existing migration tooling.

The command should:

```rust
let auth = build_better_auth(...)?;

db.apply_migrations(&auth.context.migration_plan()).await?;
secondary_storage.migrate().await?;
```

It must be:

* explicit
* repeatable/idempotent
* safe to run before deployment
* separate from server startup

### Acceptance test

Run twice against an empty local DB:

```text
first run  -> succeeds
second run -> succeeds
```

Existing StrangerTV tables must remain untouched.

---

# Phase 4 — StrangerTV legacy password provider

This is one of the most important tasks.

Current StrangerTV hashes use approximately:

```text
<32 hex salt>:<128 hex derived key>
```

with Node-compatible scrypt parameters:

```text
N = 2^14
r = 8
p = 1
key length = 64 bytes
```

Create:

```rust
pub struct StrangerTvLegacyPasswordProvider;
```

Implement Better Auth:

```rust
PasswordProvider
```

Legacy verification behavior:

```rust
verify(password, stored_hash)
```

must:

1. recognize StrangerTV legacy hash syntax
2. parse salt
3. execute the exact existing scrypt parameters
4. constant-time compare
5. return:

```rust
PasswordVerification {
    valid: true,
    needs_rehash: true,
}
```

for valid legacy credentials.

Do not use it for new hashes.

Compose:

```rust
CompositePasswordProvider {
    primary: ScryptPhcPasswordProvider,
    legacy: vec![StrangerTvLegacyPasswordProvider],
}
```

### Required fixture

Use one of StrangerTV's existing Node-compatible test vectors.

Test:

```text
legacy hash + correct password => valid + needs_rehash
legacy hash + incorrect password => invalid
new PHC hash => primary verifies
```

---

# Phase 5 — User import command

### Goal

Populate Better Auth's `user` + `account` tables without changing StrangerTV's `users` table.

Create a dedicated migration command, for example:

```bash
cargo run --bin migrate-auth-users
```

For every StrangerTV user:

```text
users.id = 123
```

create:

```text
Better Auth user.id = "123"
```

Example:

```rust
ImportCredential {
    id: Some(user.id.to_string()),
    email: user.email.clone(),
    name: ...,
    email_verified: ...,
    password_hash: user.password_hash.clone(),
    additional_fields: ...,
}
```

### Do not copy everything

Business/profile data remains in StrangerTV.

Better Auth should contain only authentication-related identity data.

For example:

```text
Better Auth:
    id
    email
    name/display identity if required
    email_verified
    credential hash

StrangerTV:
    birth date
    gender
    country
    interests
    profile metadata
    bans
    consents
    friends
    messages
    groups
    etc.
```

### Migration command requirements

Support:

```text
--dry-run
--limit N
--user-id ID
```

Prefer also:

```text
--after-id ID
```

for chunked production migration.

Log:

```text
scanned
imported
already imported
conflicts
failed
```

Never log passwords or password hashes.

### Critical property

The importer must be restartable.

If Better Auth's idempotent import API isn't available yet, explicitly query Better Auth first and treat matching ID/email as already migrated.

---

# Phase 6 — Verify lazy password migration

Before changing any production routes, verify the complete flow:

```text
legacy StrangerTV user
        ↓
Better Auth user/account already imported
        ↓
user enters existing password
        ↓
CompositePasswordProvider
        ↓
legacy verifier succeeds
        ↓
needs_rehash = true
        ↓
Better Auth generates new PHC hash
        ↓
account.password_hash updated
        ↓
session created
```

### Important

Do **not** erase:

```text
StrangerTV users.password_hash
```

yet.

Keep it for rollback until the migration is complete.

---

# Phase 7 — Unified authentication resolver

### Goal

Allow Better Auth and existing StrangerTV sessions simultaneously.

Introduce one application-facing type:

```rust
pub struct AuthenticatedUser {
    pub user_id: i64,
}
```

Create resolver:

```rust
async fn resolve_authenticated_user(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<Option<AuthenticatedUser>>
```

Resolution order:

```text
1. Better Auth cookie
2. Better Auth Bearer token
3. Legacy StrangerTV Bearer token
```

During migration only.

When Better Auth gives:

```text
principal.user.id == "42"
```

parse:

```rust
let user_id: i64 = principal.user.id.parse()?;
```

Then continue loading application data from:

```text
StrangerTV users WHERE id = 42
```

### Important architecture

Application handlers should no longer care which session implementation authenticated the user.

They should receive:

```text
AuthenticatedUser { user_id }
```

only.

---

# Phase 8 — Migrate sign-in

Keep the existing public endpoint, likely:

```text
POST /api/v1/auth/login
```

Do not force the frontend to call Better Auth's generic endpoint.

Internally replace password verification/session creation with:

```rust
EmailPasswordService::sign_in(...)
```

Return/set the Better Auth session cookie.

During the transition, optionally continue issuing the legacy bearer token if current clients need it.

Target response:

```text
Set-Cookie: better-auth...
```

plus temporarily:

```json
{
  "token": "legacy-token-if-still-required"
}
```

### Test

An old user must log in with the same password with no reset.

Then inspect Better Auth account:

```text
before login: legacy salt:key hash
after login:  PHC scrypt hash
```

---

# Phase 9 — Migrate signup

Do this **after login migration works**.

Keep StrangerTV's public registration route.

The workflow should remain application-owned:

```text
validate request
    ↓
age / 18+ policy
    ↓
username/profile validation
    ↓
consents
    ↓
create StrangerTV users row
    ↓
obtain numeric users.id
    ↓
create Better Auth credential user
    with id = users.id.to_string()
    ↓
create session
```

Use a DB transaction where practical.

Cross-system failure compensation is required.

Example:

```text
StrangerTV user created
Better Auth creation fails
```

must not silently leave a half-created signup.

Possible solution:

```text
transaction if both share same libSQL DB
```

or compensating delete.

Do not expose Better Auth `/sign-up/email` publicly.

---

# Phase 10 — Password reset

Replace StrangerTV password reset internals with Better Auth.

Required behavior:

```text
reset password
    ↓
Better Auth changes credential hash
    ↓
Better Auth revokes all Better Auth sessions
    ↓
StrangerTV revokes all legacy sessions too
```

During the bridge, both systems must be invalidated.

This is important because Better Auth currently knows nothing about StrangerTV's legacy sessions.

---

# Phase 11 — Logout

During the bridge:

```text
logout
    ↓
revoke Better Auth session
    ↓
clear Better Auth cookie
    ↓
revoke current legacy StrangerTV token/session if present
```

For global logout:

```text
Better Auth revoke_all_for_user
+
legacy revoke_all_for_user
```

---

# Phase 12 — Account deletion

Deletion ordering must be deliberate.

Recommended application operation:

```text
1. authorize user
2. mark/block account deletion if needed
3. revoke Better Auth sessions
4. revoke legacy sessions
5. remove Better Auth account/user
6. execute StrangerTV business-data deletion/anonymization policy
```

Do not let Better Auth independently delete application-owned data.

---

# Phase 13 — WebSocket migration

StrangerTV's WebSocket auth should call the same unified resolver.

During migration:

```text
Cookie => Better Auth
Bearer/query legacy auth => temporary fallback
```

Once the browser uses same-origin Better Auth cookies reliably, eliminate legacy WebSocket token handling.

Test:

```text
login
→ browser receives cookie
→ websocket upgrade
→ Better Auth resolves same user ID
```

---

# Phase 14 — Frontend cookie migration

Move the frontend away from persistent bearer storage.

Requests should use:

```javascript
fetch(url, {
  credentials: "include"
})
```

Remove new writes to:

```text
localStorage auth token
sessionStorage auth token
```

but initially still read/send legacy tokens if needed for backward compatibility.

Eventually remove:

```http
Authorization: Bearer <legacy>
```

from normal browser API requests.

---

# Phase 15 — Observability

Before switching traffic completely, add migration metrics.

Useful counters:

```text
auth.login.better_auth.success
auth.login.better_auth.failed

auth.password.legacy_verified
auth.password.legacy_rehashed

auth.session.better_auth
auth.session.legacy_fallback

auth.import.imported
auth.import.already_imported
auth.import.conflict
```

Most useful migration metric:

```text
legacy_session_fallback_rate
```

When it reaches effectively zero for longer than one complete legacy session lifetime, removal is much safer.

---

# Phase 16 — Cutover window

Current StrangerTV sessions last approximately:

```text
14 days
```

After Better Auth login/cookies have been deployed:

```text
Day 0:
    Better Auth enabled
    legacy bearer fallback enabled

Day 1–14+:
    users naturally migrate sessions/password hashes

After >= one complete legacy session lifetime:
    measure legacy fallback usage

When fallback ~0:
    stop issuing legacy sessions

Later:
    remove legacy session authentication
```

Do not use exactly day 14 as an automatic deletion date. Use telemetry.

---

# Phase 17 — Remove legacy session system

Once safe:

Remove:

```text
legacy session creation
legacy bearer fallback
legacy authorization parsing
legacy WS token handling
```

The old sessions table can remain temporarily for rollback/archive.

Do not immediately drop it.

---

# Phase 18 — Password-hash cleanup

After the rollback window:

StrangerTV no longer needs to authenticate against:

```text
users.password_hash
```

Options:

```text
A. set old password hashes NULL
B. remove the column in a later schema migration
```

Do this only after verifying Better Auth credential coverage.

Precondition:

```text
every active StrangerTV user
has corresponding Better Auth user/account
```

---

# Database identity invariant

This should be documented prominently:

```text
For StrangerTV users:

parse::<i64>(better_auth.user.id)
    ==
strangertv.users.id
```

Example:

```text
StrangerTV users
┌─────┬───────────────────┐
│ id  │ email             │
├─────┼───────────────────┤
│ 42  │ user@example.com  │
└─────┴───────────────────┘

Better Auth user
┌──────┬───────────────────┐
│ id   │ email             │
├──────┼───────────────────┤
│ "42" │ user@example.com  │
└──────┴───────────────────┘

Better Auth account
┌─────────────────┬─────────┐
│ id              │ user_id │
├─────────────────┼─────────┤
│ 42:credential   │ "42"    │
└─────────────────┴─────────┘
```

Do not add a UUID mapping layer unless this strategy proves impossible.

---

# Suggested PR breakdown for coding agents

Keep each LLM task bounded:

```text
PR 1  Vendor/pin better-auth-rs + build/CI support
PR 2  BetterAuthState + explicit auth migrations
PR 3  StrangerTV legacy PasswordProvider
PR 4  Restartable auth-user importer
PR 5  Unified session/auth resolver
PR 6  Better Auth login + dual-session bridge
PR 7  Better Auth-backed registration
PR 8  Reset/logout/global-revoke bridge
PR 9  WebSocket Better Auth support
PR 10 Frontend cookie-session migration
PR 11 Stop issuing legacy sessions
PR 12 Remove legacy session fallback
PR 13 Remove legacy password authentication/storage
```

This is substantially safer than giving one LLM “replace auth with Better Auth.”

---

# Mandatory test matrix

Each agent should preserve/add tests covering:

| Scenario                                        | Required |
| ----------------------------------------------- | -------: |
| Existing user imported                          |        ✅ |
| Numeric ID preserved                            |        ✅ |
| Existing password works                         |        ✅ |
| Legacy hash upgraded after login                |        ✅ |
| Wrong legacy password rejected                  |        ✅ |
| New Better Auth password works                  |        ✅ |
| Better Auth cookie authenticates REST           |        ✅ |
| Better Auth bearer authenticates REST           |        ✅ |
| Legacy bearer fallback works during bridge      |        ✅ |
| WebSocket cookie auth                           |        ✅ |
| Logout invalidates session                      |        ✅ |
| Password reset invalidates Better Auth sessions |        ✅ |
| Password reset invalidates legacy sessions      |        ✅ |
| Global logout invalidates both                  |        ✅ |
| Re-running importer is safe                     |        ✅ |
| Email/ID conflict detected                      |        ✅ |
| Fresh DB migration succeeds                     |        ✅ |
| Migration can run twice                         |        ✅ |
| Existing social tables unchanged                |        ✅ |
| Docker build with submodule                     |        ✅ |
| CI checkout with submodule                      |        ✅ |

---

# Production gate

Do **not** remove StrangerTV's old auth until all of these are true:

```text
[ ] better-auth-rs pinned, not floating
[ ] Better Auth CI green
[ ] live Turso/libSQL conformance test passes
[ ] auth schema migration tested on staging copy
[ ] user importer is restartable
[ ] import conflicts reviewed
[ ] existing password fixture works
[ ] lazy password rehash verified
[ ] REST cookie auth verified
[ ] WebSocket cookie auth verified
[ ] password reset revokes both session types
[ ] logout revokes both session types
[ ] rollback procedure tested
[ ] legacy fallback telemetry is available
[ ] one full legacy session lifetime has elapsed before removal
```

## Master prompt for an implementation LLM

You can give the following to a coding agent together with this plan:

```text
Implement only the next unfinished phase of the StrangerTV Better Auth
migration described in the migration plan.

Repositories:
- nglmercer/strangertv
- nglmercer/better-auth-rs

Pin better-auth-rs at:
aa0117e49d30ff69d1ed36c74df27193c062f2de

Before modifying anything:
1. Inspect the current repository and latest branch state.
2. Identify whether previous migration phases are already implemented.
3. Do not redo completed work.
4. Create a feature branch from the current default branch.
5. Keep the PR limited to one migration phase.

Architecture invariants:
- StrangerTV numeric users.id remains canonical.
- Better Auth user.id for StrangerTV users is users.id.to_string().
- Do not migrate application/social foreign keys.
- Do not expose Better Auth stock signup directly.
- Do not auto-run schema migrations during server startup.
- Preserve legacy passwords and sessions during the bridge.
- Prefer Better Auth cookie/session first and legacy bearer only as fallback.
- Do not remove rollback paths prematurely.
- Never log plaintext passwords, session tokens, or password hashes.

Implementation requirements:
- Add focused tests.
- Run cargo fmt.
- Run cargo check.
- Run relevant tests.
- Run workspace/all-feature checks where practical.
- Inspect the final diff for unrelated changes.
- Document any migration/deployment step introduced.
- Make the change independently deployable.
- Describe rollback behavior.

If an existing implementation differs from this plan, inspect why before
changing it. Prefer compatibility with deployed StrangerTV behavior over
blindly following pseudocode.

At completion report:
1. files changed
2. behavior implemented
3. tests executed/results
4. deployment or DB migration requirements
5. remaining migration phase
6. risks or blockers
```

The key implementation choice I would lock in for all agents is **`StrangerTV users.id = Better Auth user.id parsed as a string`**. That avoids introducing a second identity system and makes the rest of the migration considerably simpler.

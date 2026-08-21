// Extends node-users.db with session rows whose token_hash is computed by Node,
// exactly as server/auth.ts did:
//
//   export const hashToken = (token) => createHash('sha256').update(token).digest('hex')
//
// The raw tokens are recorded in node-session-tokens.json so the Rust tests can
// prove the whole chain -- Node-issued token -> Rust hash_token() -> session row
// -> user -- rather than merely counting rows. Run with: node <this file>
// (Node >= 22, no dependencies: node:sqlite and node:crypto are built in.)
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')
// server/auth.ts randomToken() is 32 random bytes base64url-encoded. The tokens
// here are derived deterministically from a label instead so re-running this
// script is idempotent: the same label yields the same token/token_hash, and the
// writer below only touches rows that are missing or wrong, so a rerun against an
// already-correct fixture performs zero SQL writes and leaves the file's bytes
// unchanged. Only the hash computation needs to be Node's; the token value
// itself is arbitrary.
const nodeToken = (label) =>
  createHash('sha256').update(`stranger-fixture-session:${label}`).digest('base64url')

const here = new URL('.', import.meta.url).pathname
const db = new DatabaseSync(here + 'node-users.db')

// Guard rails: the fixture is precious (it is the Node->Rust compatibility
// oracle), so refuse to touch a database that is not intact, and verify the
// seed data survives before and after the write.
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
if (integrity !== 'ok') {
  console.error(`refusing to write: integrity_check = ${integrity}`)
  process.exit(1)
}
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
if (userCount < 1) {
  console.error(`refusing to write: fixture has ${userCount} users, expected >= 1`)
  process.exit(1)
}

const tokens = {
  live: nodeToken('live'),
  revoked: nodeToken('revoked'),
  expired: nodeToken('expired'),
}
const rows = [
  [tokens.live, '2099-01-01T00:00:00.000Z', 0],
  [tokens.revoked, '2099-01-01T00:00:00.000Z', 1],
  [tokens.expired, '2000-01-01T00:00:00.000Z', 0],
]

// Write only what is actually missing or different. Any SQL write -- even an
// UPDATE that sets identical values -- bumps SQLite's file change counter, so a
// "just upsert everything" approach would change the fixture's bytes on every
// run. Checking first makes a rerun against an already-correct fixture perform
// zero writes and leave the file byte-identical. When a row must change, an
// ON CONFLICT ... DO UPDATE upsert (not INSERT OR REPLACE) preserves its row id
// on the AUTOINCREMENT table instead of deleting+reinserting it.
const find = db.prepare('SELECT expires_at, revoked FROM sessions WHERE token_hash = ?')
const upsert = db.prepare(
  `INSERT INTO sessions (user_id, token_hash, expires_at, revoked) VALUES (1, ?, ?, ?)
   ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at, revoked = excluded.revoked`
)
let writes = 0
for (const [token, expires, revoked] of rows) {
  const hash = hashToken(token)
  const existing = find.get(hash)
  if (!existing || existing.expires_at !== expires || existing.revoked !== revoked) {
    upsert.run(hash, expires, revoked)
    writes++
  }
}

// sqlite_sequence can be left inflated (e.g. by earlier INSERT OR REPLACE runs).
// Renormalise it to the real max id, but only when needed, for the same reason.
const maxId = db.prepare('SELECT MAX(id) AS m FROM sessions').get().m
const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'sessions'").get()
if (!seq || seq.seq !== maxId) {
  db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'sessions'").run(maxId)
  writes++
}

// Verify the write landed and did not disturb the seed data before persisting
// the token manifest (the Rust tests consume both together).
const sessionCount = db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c
const usersAfter = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
if (usersAfter !== userCount || sessionCount < rows.length) {
  console.error(
    `verification failed: users ${userCount} -> ${usersAfter}, sessions=${sessionCount} (expected >= ${rows.length})`
  )
  process.exit(1)
}

db.close()
writeFileSync(here + 'node-session-tokens.json', JSON.stringify(tokens, null, 2) + '\n')
console.log(
  writes === 0
    ? `fixture already up to date; no SQL writes performed (users intact: ${usersAfter})`
    : `performed ${writes} write(s) across ${rows.length} Node-hashed sessions (users intact: ${usersAfter})`
)

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
// script is idempotent (same token -> same token_hash -> INSERT OR REPLACE is a
// no-op rather than accumulating rows). Only the hash computation needs to be
// Node's; the token value itself is arbitrary.
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

const insert = db.prepare(
  'INSERT OR REPLACE INTO sessions (user_id, token_hash, expires_at, revoked) VALUES (1, ?, ?, ?)'
)
for (const [token, expires, revoked] of rows) insert.run(hashToken(token), expires, revoked)

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
console.log(`wrote ${rows.length} Node-hashed sessions and node-session-tokens.json (users intact: ${usersAfter})`)

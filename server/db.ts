import { createClient, type Client } from '@libsql/client'

export const tursoUrl = process.env.TURSO_DATABASE_URL ?? 'file:local.db'
export const db: Client = createClient({
  url: tursoUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export async function migrate() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      birth_date TEXT,
      gender TEXT DEFAULT 'other',
      country TEXT DEFAULT 'any',
      language TEXT DEFAULT 'en',
      interests TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_id, blocked_id)
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER,
      reporter_session TEXT,
      room_id TEXT,
      reason TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      ip TEXT,
      reason TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      kind TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const columns = ['birth_date', 'gender', 'country', 'language', 'interests']
  for (const col of columns) {
    try {
      await db.execute(`ALTER TABLE users ADD COLUMN ${col} TEXT`)
    } catch {
      /* column exists */
    }
  }
}

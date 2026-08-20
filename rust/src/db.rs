//! Database access. Port of `server/db.ts`.
//!
//! Same libSQL client, same `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` env vars and
//! the same `file:` local mode, so an existing database opens unchanged — there
//! is no data migration in this port.
//!
//! The DDL below is copied verbatim from the TypeScript version, including the
//! `ALTER TABLE` add-column steps whose failures are ignored (SQLite has no
//! `ADD COLUMN IF NOT EXISTS`, so "already exists" is the normal path).

use libsql::{Builder, Connection, Database};

pub const REPORT_STATUS_OPEN: &str = "open";

/// SQL column defaults, matching `DB_DEFAULTS` in shared/constants.ts. These
/// apply only to rows inserted without the column — they are NOT the values the
/// API falls back to, which live in `constants.rs` and are all `"any"`.
pub const DB_DEFAULT_GENDER: &str = "other";
pub const DB_DEFAULT_COUNTRY: &str = "any";
pub const DB_DEFAULT_LANGUAGE: &str = "en";

pub struct Db {
    _database: Database,
    conn: Connection,
    pub url: String,
}

impl Db {
    pub async fn connect() -> anyhow::Result<Self> {
        let url = std::env::var("TURSO_DATABASE_URL").unwrap_or_else(|_| "file:local.db".into());
        Self::open(&url).await
    }

    /// Open a specific database. `connect()` is the env-driven entry point;
    /// this exists so tests can point at a fixture without touching the process
    /// environment (which is global and races across parallel tests).
    pub async fn open(url: &str) -> anyhow::Result<Self> {
        let url = url.to_string();
        let auth_token = std::env::var("TURSO_AUTH_TOKEN").unwrap_or_default();

        // Remote only for a real remote scheme; everything else is a local
        // path. `file:local.db` is what deployments use, and `:memory:` is what
        // the tests use — both must stay off the Hrana client.
        let is_remote = ["libsql://", "http://", "https://", "ws://", "wss://"]
            .iter()
            .any(|scheme| url.starts_with(scheme));
        let database = if is_remote {
            Builder::new_remote(url.clone(), auth_token).build().await?
        } else {
            Builder::new_local(url.strip_prefix("file:").unwrap_or(&url))
                .build()
                .await?
        };
        let conn = database.connect()?;
        Ok(Self {
            _database: database,
            conn,
            url,
        })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// `local libSQL` vs `turso`, as reported by `/api/v1/health`.
    pub fn kind(&self) -> &'static str {
        if self.url.starts_with("file:") {
            "local libSQL"
        } else {
            "turso"
        }
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        for stmt in CREATE_TABLES {
            self.conn.execute(stmt, ()).await?;
        }
        // Best-effort: indexes that can conflict on rows with NULL keys, and
        // columns added to tables that predate them.
        for stmt in BEST_EFFORT {
            let _ = self.conn.execute(stmt, ()).await;
        }
        Ok(())
    }
}

const CREATE_TABLES: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      birth_date TEXT,
      gender TEXT DEFAULT 'other',
      country TEXT DEFAULT 'any',
      language TEXT DEFAULT 'en',
      interests TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_id, blocked_id)
    )",
    "CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER,
      reporter_session TEXT,
      room_id TEXT,
      reason TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT,
      rater_id INTEGER,
      rater_session TEXT,
      score INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      ip TEXT,
      reason TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      kind TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id INTEGER NOT NULL,
      user_b_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_a_id, user_b_id)
    )",
    "CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      followed_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, followed_id)
    )",
    "CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id INTEGER NOT NULL,
      invitee_id INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      UNIQUE(inviter_id, invitee_id, room_id)
    )",
    "CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (recipient_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS group_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      inviter_id INTEGER NOT NULL,
      invitee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (inviter_id) REFERENCES users(id),
      FOREIGN KEY (invitee_id) REFERENCES users(id),
      UNIQUE(group_id, invitee_id)
    )",
    "CREATE TABLE IF NOT EXISTS group_match_rooms (
      id TEXT PRIMARY KEY,
      host_user_id INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      matched_room_id TEXT,
      FOREIGN KEY (host_user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS group_match_participants (
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      email TEXT,
      session_key TEXT,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES group_match_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
];

/// Statements whose failure is expected and ignored, exactly as in `db.ts`.
const BEST_EFFORT: &[&str] = &[
    "CREATE UNIQUE INDEX IF NOT EXISTS ratings_room_session ON ratings (room_id, rater_session)",
    "CREATE INDEX IF NOT EXISTS messages_pair ON messages (sender_id, recipient_id, created_at)",
    "ALTER TABLE users ADD COLUMN birth_date TEXT",
    "ALTER TABLE users ADD COLUMN gender TEXT",
    "ALTER TABLE users ADD COLUMN country TEXT",
    "ALTER TABLE users ADD COLUMN language TEXT",
    "ALTER TABLE users ADD COLUMN interests TEXT",
    "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
    // Who was reported. A 1:1 report is unambiguous, but a group match has
    // several participants, so the reporter names one.
    "ALTER TABLE reports ADD COLUMN reported_id INTEGER",
    "ALTER TABLE invitations ADD COLUMN context TEXT DEFAULT 'match'",
];

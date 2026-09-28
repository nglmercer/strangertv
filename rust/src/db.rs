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

/// The DDL above inlines these values as SQL literals (SQLite needs them
/// inline); the constants name them so the schema and the queries that filter
/// on them cannot drift apart unnoticed.
#[allow(dead_code)]
pub const REPORT_STATUS_OPEN: &str = "open";

/// SQL column defaults, matching `DB_DEFAULTS` in shared/constants.ts. These
/// apply only to rows inserted without the column — they are NOT the values the
/// API falls back to, which live in `constants.rs` and are all `"any"`.
#[allow(dead_code)]
pub const DB_DEFAULT_GENDER: &str = "other";
#[allow(dead_code)]
pub const DB_DEFAULT_COUNTRY: &str = "any";
#[allow(dead_code)]
pub const DB_DEFAULT_LANGUAGE: &str = "en";

pub struct Db {
    _database: Database,
    conn: Connection,
    pub url: String,
}

impl Db {
    /// Environment-driven connection from `TURSO_DATABASE_URL`. Development
    /// falls back to a local `file:local.db` so `cargo run` "just works";
    /// production refuses to guess and fails with a clear message if the URL is
    /// missing, so a misconfigured deploy can never silently start against the
    /// wrong database and surface as a mysterious 502.
    pub async fn connect() -> anyhow::Result<Self> {
        let is_prod = std::env::var("NODE_ENV")
            .map(|v| v == "production")
            .unwrap_or(false);

        let url = match std::env::var("TURSO_DATABASE_URL") {
            Ok(url) if !url.trim().is_empty() => url,
            _ if !is_prod => {
                crate::log_warn!("db.default_url", {
                    "reason": "TURSO_DATABASE_URL not set; using development database file:local.db"
                });
                "file:local.db".to_string()
            }
            _ => {
                anyhow::bail!(
                    "TURSO_DATABASE_URL is required in production. For a persistent \
                     local database set TURSO_DATABASE_URL=file:/data/local.db, or \
                     configure your Turso database URL."
                );
            }
        };

        Self::open(&url).await
    }

    /// Open a specific database. `connect()` is the env-driven entry point;
    /// this exists so tests can point at a fixture without touching the process
    /// environment (which is global and races across parallel tests).
    pub async fn open(url: &str) -> anyhow::Result<Self> {
        // Local file preflight: fail with a useful message before libSQL does.
        // Relative dev paths (`file:local.db`) and `:memory:` have no parent
        // directory to check, so those are skipped.
        if let Some(path) = url.strip_prefix("file:") {
            if let Some(parent) = std::path::Path::new(path).parent() {
                if !parent.as_os_str().is_empty() && !parent.exists() {
                    anyhow::bail!(
                        "database directory does not exist: {}",
                        parent.display()
                    );
                }
            }
        }

        let url = url.to_string();
        let auth_token = std::env::var("TURSO_AUTH_TOKEN").unwrap_or_default();

        // Remote only for a real remote scheme; everything else is a local
        // path. `file:local.db` is what deployments use, and `:memory:` is what
        // the tests use — both must stay off the Hrana client.
        let is_remote = ["libsql://", "http://", "https://", "ws://", "wss://"]
            .iter()
            .any(|scheme| url.starts_with(scheme));

        if is_remote && auth_token.trim().is_empty() {
            anyhow::bail!(
                "TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is remote"
            );
        }

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
        // Existing databases predate usernames: every account gets a stable
        // /u/:handle derived from its email. A no-op once all rows have one.
        crate::domain::profiles::backfill_usernames(self.conn()).await?;
        // Existing databases predate the points economy: grant the starting
        // balance once to accounts that never received it.
        crate::domain::economy::backfill_balances(self.conn()).await?;
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
      username TEXT,
      display_name TEXT,
      bio TEXT,
      website TEXT,
      avatar_media_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS profile_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'gray',
      UNIQUE(user_id, position),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS profile_sections (
      user_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Links',
      icon TEXT NOT NULL DEFAULT '',
      layout TEXT NOT NULL DEFAULT 'rows',
      show_count INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id)
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
      description TEXT,
      image_media_id INTEGER,
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
    "CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      entry_url TEXT NOT NULL,
      max_players INTEGER NOT NULL DEFAULT 8,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS activity_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      FOREIGN KEY (activity_id) REFERENCES activities(id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS activity_participants (
      instance_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (instance_id, user_id),
      FOREIGN KEY (instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS activity_launch_codes (
      code_hash TEXT PRIMARY KEY,
      instance_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS activity_tokens (
      token_hash TEXT PRIMARY KEY,
      instance_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )",
    "CREATE TABLE IF NOT EXISTS point_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "ALTER TABLE users ADD COLUMN username TEXT",
    "ALTER TABLE users ADD COLUMN display_name TEXT",
    "ALTER TABLE users ADD COLUMN bio TEXT",
    "ALTER TABLE users ADD COLUMN website TEXT",
    "ALTER TABLE users ADD COLUMN avatar_media_id INTEGER",
    "ALTER TABLE groups ADD COLUMN description TEXT",
    "ALTER TABLE groups ADD COLUMN image_media_id INTEGER",
    "CREATE INDEX IF NOT EXISTS media_owner ON media (user_id, kind)",
    "CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (username COLLATE NOCASE)",
    "ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
    // Who was reported. A 1:1 report is unambiguous, but a group match has
    // several participants, so the reporter names one.
    "ALTER TABLE reports ADD COLUMN reported_id INTEGER",
    "ALTER TABLE invitations ADD COLUMN context TEXT DEFAULT 'match'",
    "CREATE INDEX IF NOT EXISTS activity_instances_group ON activity_instances (group_id, status)",
    "INSERT OR IGNORE INTO activities (slug, name, description, entry_url, max_players) VALUES ('tictactoe', 'Tic-Tac-Toe', 'Classic 3-in-a-row for two players.', '/activities/tictactoe', 2)",
    "ALTER TABLE users ADD COLUMN points_balance INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS ledger_user ON point_ledger (user_id, created_at)",
];

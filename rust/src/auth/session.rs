//! Session issue/lookup/revoke and user rows. Port of the DB-backed half of
//! `server/auth.ts`.

use libsql::params;

use crate::auth::password::{hash_token, random_token};
use crate::constants::{DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE};
use crate::db::Db;
use crate::proto::{Gender, PublicUser};

const SESSION_DAYS: i64 = 14;

#[derive(Debug, Clone)]
pub struct UserRow {
    pub id: i64,
    pub email: String,
    pub birth_date: Option<String>,
    pub gender: Option<String>,
    pub country: Option<String>,
    pub language: Option<String>,
    pub interests: Option<String>,
    pub email_verified: i64,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub website: Option<String>,
}

/// `new Date(...).toISOString()` — the format already stored in `expires_at`.
fn iso_in_days(days: i64) -> String {
    use time::format_description::well_known::Rfc3339;
    let at = time::OffsetDateTime::now_utc() + time::Duration::days(days);
    at.format(&Rfc3339).unwrap_or_default()
}

pub async fn create_session(db: &Db, user_id: i64) -> anyhow::Result<String> {
    let token = random_token();
    db.conn()
        .execute(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
            params![user_id, hash_token(&token), iso_in_days(SESSION_DAYS)],
        )
        .await?;
    Ok(token)
}

pub async fn revoke_session(db: &Db, token: &str) -> anyhow::Result<()> {
    db.conn()
        .execute(
            "UPDATE sessions SET revoked = 1 WHERE token_hash = ?",
            params![hash_token(token)],
        )
        .await?;
    Ok(())
}

/// Revoke every legacy session belonging to a user.
///
/// Better Auth browser sessions also receive a legacy compatibility session
/// during the migration. A cookie-only Better Auth logout has no legacy token
/// to identify, so it must invalidate the compatibility sessions by user.
pub async fn revoke_all_sessions(db: &Db, user_id: i64) -> anyhow::Result<()> {
    db.conn()
        .execute(
            "UPDATE sessions SET revoked = 1 WHERE user_id = ?",
            params![user_id],
        )
        .await?;
    Ok(())
}

/// Issue a new session token and revoke the previous one (sliding sessions).
pub async fn refresh_session(db: &Db, token: &str) -> anyhow::Result<Option<String>> {
    let Some(user) = user_from_token(db, Some(token)).await? else {
        return Ok(None);
    };
    revoke_session(db, token).await?;
    Ok(Some(create_session(db, user.id).await?))
}

/// Pre-username schemas fail the full select with `no such column`; retry
/// without the column so Node-era databases keep authenticating. Mirrors
/// `better_auth_schema_not_ready`: production always migrates first, so the
/// fallback only triggers on databases opened raw.
fn is_missing_column(message: &str) -> bool {
    message.to_ascii_lowercase().contains("no such column")
}

/// Load an application user by the canonical numeric StrangerTV ID.
pub async fn user_from_id(db: &Db, user_id: i64) -> anyhow::Result<Option<UserRow>> {
    let full = "SELECT id, email, birth_date, gender, country, language, interests, email_verified, username, display_name, bio, website
         FROM users
         WHERE id = ?";
    let legacy = "SELECT id, email, birth_date, gender, country, language, interests, email_verified
         FROM users
         WHERE id = ?";
    let mut rows = match db.conn().query(full, params![user_id]).await {
        Ok(rows) => rows,
        Err(error) if is_missing_column(&error.to_string()) => {
            db.conn().query(legacy, params![user_id]).await?
        }
        Err(error) => return Err(error.into()),
    };
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    Ok(Some(UserRow {
        id: row.get(0)?,
        email: row.get(1)?,
        birth_date: row.get(2).ok(),
        gender: row.get(3).ok(),
        country: row.get(4).ok(),
        language: row.get(5).ok(),
        interests: row.get(6).ok(),
        email_verified: row.get(7).unwrap_or(0),
        // None on legacy schemas: the missing column reads as Null.
        username: row.get(8).ok(),
        display_name: row.get(9).ok(),
        bio: row.get(10).ok(),
        website: row.get(11).ok(),
    }))
}

pub async fn user_from_token(db: &Db, token: Option<&str>) -> anyhow::Result<Option<UserRow>> {
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    let full = "SELECT u.id, u.email, u.birth_date, u.gender, u.country, u.language, u.interests, u.email_verified, u.username, u.display_name, u.bio, u.website
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > datetime('now')";
    let legacy = "SELECT u.id, u.email, u.birth_date, u.gender, u.country, u.language, u.interests, u.email_verified
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > datetime('now')";
    let hashed = hash_token(token);
    let mut rows = match db.conn().query(full, params![hashed.clone()]).await {
        Ok(rows) => rows,
        Err(error) if is_missing_column(&error.to_string()) => {
            db.conn().query(legacy, params![hashed]).await?
        }
        Err(error) => return Err(error.into()),
    };

    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    Ok(Some(UserRow {
        id: row.get(0)?,
        email: row.get(1)?,
        birth_date: row.get(2).ok(),
        gender: row.get(3).ok(),
        country: row.get(4).ok(),
        language: row.get(5).ok(),
        interests: row.get(6).ok(),
        email_verified: row.get(7).unwrap_or(0),
        // None on legacy schemas: the missing column reads as Null.
        username: row.get(8).ok(),
        display_name: row.get(9).ok(),
        bio: row.get(10).ok(),
        website: row.get(11).ok(),
    }))
}

pub async fn is_banned(db: &Db, user_id: Option<i64>, ip: Option<&str>) -> anyhow::Result<bool> {
    if let Some(user_id) = user_id.filter(|id| *id != 0) {
        let mut rows = db
            .conn()
            .query(
                "SELECT id FROM bans WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1",
                params![user_id],
            )
            .await?;
        if rows.next().await?.is_some() {
            return Ok(true);
        }
    }
    if let Some(ip) = ip.filter(|s| !s.is_empty()) {
        let mut rows = db
            .conn()
            .query(
                "SELECT id FROM bans WHERE ip = ? AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1",
                params![ip],
            )
            .await?;
        if rows.next().await?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `parseInterests` in `shared/json.ts`: a JSON array of strings, or `[]` for
/// anything unparseable — the column has held bad data before.
pub fn parse_interests(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

pub fn public_user(u: &UserRow) -> PublicUser {
    PublicUser {
        id: u.id,
        email: u.email.clone(),
        birth_date: u.birth_date.clone(),
        gender: Some(
            u.gender
                .as_deref()
                .and_then(gender_from_str)
                .unwrap_or_else(|| gender_from_str(DEFAULT_GENDER).expect("valid default")),
        ),
        country: Some(u.country.clone().unwrap_or_else(|| DEFAULT_COUNTRY.into())),
        language: Some(
            u.language
                .clone()
                .unwrap_or_else(|| DEFAULT_LANGUAGE.into()),
        ),
        interests: Some(parse_interests(u.interests.as_deref())),
        email_verified: Some(u.email_verified != 0),
        username: u.username.clone(),
        display_name: u.display_name.clone().filter(|s| !s.is_empty()),
        bio: u.bio.clone().filter(|s| !s.is_empty()),
        website: u.website.clone().filter(|s| !s.is_empty()),
    }
}

fn gender_from_str(s: &str) -> Option<Gender> {
    match s {
        "any" => Some(Gender::Any),
        "male" => Some(Gender::Male),
        "female" => Some(Gender::Female),
        "other" => Some(Gender::Other),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_missing_column_triggers_the_legacy_user_select() {
        assert!(is_missing_column("no such column: u.username"));
        assert!(is_missing_column("SQLITE_ERROR: No Such Column: users.username"));
        assert!(!is_missing_column("database is locked"));
        assert!(!is_missing_column("no such table: users"));
    }

    #[test]
    fn interests_default_to_empty_on_junk() {
        assert_eq!(parse_interests(None), Vec::<String>::new());
        assert_eq!(parse_interests(Some("")), Vec::<String>::new());
        assert_eq!(parse_interests(Some("not json")), Vec::<String>::new());
        assert_eq!(parse_interests(Some("{}")), Vec::<String>::new());
        assert_eq!(
            parse_interests(Some(r#"["music","tech"]"#)),
            vec!["music".to_string(), "tech".to_string()]
        );
    }

    /// An unknown gender in the column must fall back rather than be dropped:
    /// `publicUser` casts `u.gender ?? DEFAULT_GENDER`.
    #[test]
    fn public_user_fills_defaults_for_missing_profile_columns() {
        let row = UserRow {
            id: 7,
            email: "a@b.co".into(),
            birth_date: None,
            gender: None,
            country: None,
            language: None,
            interests: None,
            email_verified: 0,
            username: None,
            display_name: None,
            bio: None,
            website: None,
        };
        let pu = public_user(&row);
        // All three application defaults are "any" — deliberately NOT the SQL
        // column defaults (other/any/en), which never reach the API.
        assert_eq!(pu.gender, Some(Gender::Any));
        assert_eq!(pu.country.as_deref(), Some("any"));
        assert_eq!(pu.language.as_deref(), Some("any"));
        assert_eq!(pu.interests, Some(vec![]));
        assert_eq!(pu.email_verified, Some(false));
        assert_eq!(pu.birth_date, None);
    }
}

/// Compatibility with databases written by the TypeScript server.
///
/// `node-users.db` was produced by running `server/index.ts` and registering
/// `compat@example.com` over the real HTTP API. These tests are the Phase 2
/// production-shaped database and authenticate a user it did not create.
#[cfg(test)]
mod node_compat {
    use super::*;
    use crate::auth::password::verify_password;

    const FIXTURE: &str = "file:tests/fixtures/node-users.db";
    const EMAIL: &str = "compat@example.com";
    const PASSWORD: &str = "password12";

    async fn fixture_db() -> Db {
        Db::open(FIXTURE)
            .await
            .expect("fixture database opens with the libsql Rust client")
    }

    #[tokio::test]
    async fn reads_a_user_row_written_by_the_node_server() {
        let db = fixture_db().await;
        let mut rows = db
            .conn()
            .query(
                "SELECT id, email, birth_date, gender, country, language, interests, email_verified
                 FROM users WHERE email = ?",
                params![EMAIL],
            )
            .await
            .expect("query runs");
        let row = rows.next().await.expect("query ok").expect("user exists");

        assert_eq!(row.get::<i64>(0).unwrap(), 1);
        assert_eq!(row.get::<String>(1).unwrap(), EMAIL);
        assert_eq!(row.get::<String>(2).unwrap(), "1990-02-02");
    }

    /// The one that matters: a password hashed by Node, verified by Rust.
    #[tokio::test]
    async fn authenticates_against_a_hash_written_by_the_node_server() {
        let db = fixture_db().await;
        let mut rows = db
            .conn()
            .query(
                "SELECT password_hash FROM users WHERE email = ?",
                params![EMAIL],
            )
            .await
            .expect("query runs");
        let row = rows.next().await.expect("query ok").expect("user exists");
        let stored: String = row.get(0).expect("password_hash column");

        assert!(
            verify_password(PASSWORD, &stored),
            "Rust must verify a scrypt hash produced by server/auth.ts"
        );
        assert!(!verify_password("wrong-password", &stored));
    }

    /// `migrate()` runs against an already-migrated database without error, so
    /// a Rust deploy can start on top of the live schema.
    #[tokio::test]
    async fn migrate_is_idempotent_over_the_node_schema() {
        // Copy: migrate writes (new columns, username backfill) and must
        // never mutate the committed fixture other tests read concurrently.
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("stranger-node-migrate-{suffix}.db"));
        std::fs::copy("tests/fixtures/node-users.db", &path).expect("fixture copies");
        let url = format!("file:{}", path.display());
        let db = Db::open(&url).await.expect("copy opens");
        db.migrate().await.expect("migrate is idempotent");
        db.migrate()
            .await
            .expect("and stays idempotent on a re-run");
        // The backfill gave the Node-era account a handle from its email.
        let mut rows = db
            .conn()
            .query("SELECT username FROM users WHERE email = ?", params![EMAIL])
            .await
            .expect("username reads");
        let row = rows.next().await.expect("row").expect("user");
        assert_eq!(row.get::<String>(0).expect("username"), "compat");
        drop(db);
        let _ = std::fs::remove_file(path);
    }

    /// The Node-issued session tokens in `node-session-tokens.json` were hashed
    /// by Node's `createHash('sha256')` (server/auth.ts `hashToken`). Resolving
    /// one through `user_from_token` proves the full chain -- Node token ->
    /// Rust `hash_token()` -> session row -> user -- not just that rows exist.
    #[tokio::test]
    async fn resolves_a_session_token_issued_by_the_node_server() {
        let tokens: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/node-session-tokens.json"
        ))
        .expect("fixture token manifest parses");
        let token = |name: &str| tokens[name].as_str().expect("token present").to_string();
        let db = fixture_db().await;

        let user = user_from_token(&db, Some(&token("live")))
            .await
            .expect("lookup runs")
            .expect("a token Node issued must resolve to its user");
        assert_eq!(user.id, 1);
        assert_eq!(user.email, EMAIL);

        // The same lookup still honours the two exclusion filters.
        assert!(
            user_from_token(&db, Some(&token("revoked")))
                .await
                .unwrap()
                .is_none(),
            "revoked = 1 must not authenticate"
        );
        assert!(
            user_from_token(&db, Some(&token("expired")))
                .await
                .unwrap()
                .is_none(),
            "an expired session must not authenticate"
        );

        // An unknown token resolves to nobody rather than erroring.
        assert!(user_from_token(&db, Some("not-a-real-token"))
            .await
            .expect("lookup runs")
            .is_none());
        assert!(user_from_token(&db, None).await.unwrap().is_none());
    }
}

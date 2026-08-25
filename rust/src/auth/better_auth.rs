//! Better Auth infrastructure for the staged StrangerTV migration.
//!
//! This module deliberately owns construction only. The server keeps the
//! state available for the later resolver/login phases, but startup never
//! applies Better Auth DDL. The explicit `migrate-auth` binary is the only
//! entry point that changes the Better Auth schema.

use std::sync::Arc;

use better_auth::{
    core::{AuthOptions, BaseUrl, CookieOptions, DbAdapter, Query, SessionOptions},
    CompositePasswordProvider, CredentialService, LibSqlDbAdapter, LibSqlSecondaryStorage,
    ScryptPhcPasswordProvider, SessionService,
};
use libsql::{Builder, Connection, Database};

use crate::auth::password::{is_legacy_hash_format, StrangerTvLegacyPasswordProvider};
use crate::config::Config;

const SESSION_SECONDS: u64 = 14 * 24 * 60 * 60;
const SESSION_UPDATE_SECONDS: u64 = 24 * 60 * 60;
const DEVELOPMENT_DATABASE_URL: &str = "file:local.db";

/// Runtime Better Auth objects. `adapter` and `secondary_storage` are kept as
/// concrete handles so the explicit migration command can apply the schema;
/// request routing is intentionally left to a later migration phase.
pub struct BetterAuthState {
    pub context: better_auth::AuthContext,
    pub credentials: CredentialService,
    pub sessions: SessionService,
    pub adapter: Arc<LibSqlDbAdapter>,
    pub secondary_storage: Arc<LibSqlSecondaryStorage>,
}

/// Raw libSQL handle used by the explicit user importer to read StrangerTV's
/// plural `users` table. Better Auth's adapter intentionally registers only
/// its own schema, so legacy application reads stay outside that adapter.
#[allow(dead_code)]
pub struct LegacyDatabase {
    _database: Database,
    pub conn: Connection,
}

impl BetterAuthState {
    /// Connect to the same libSQL/Turso target as StrangerTV's existing `Db`.
    /// No schema migration is performed here.
    pub async fn connect(config: &Config, database_url: &str) -> anyhow::Result<Self> {
        let auth_token = std::env::var("TURSO_AUTH_TOKEN").unwrap_or_default();
        Self::connect_with(config, database_url, &auth_token).await
    }

    /// Testable/deployment-friendly constructor that does not read secrets
    /// from process-global state except through its explicit arguments.
    pub async fn connect_with(
        config: &Config,
        database_url: &str,
        auth_token: &str,
    ) -> anyhow::Result<Self> {
        let adapter = Arc::new(if is_remote_url(database_url) {
            if auth_token.trim().is_empty() {
                anyhow::bail!("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is remote");
            }
            LibSqlDbAdapter::remote(database_url.to_owned(), auth_token.to_owned()).await?
        } else {
            LibSqlDbAdapter::local(local_path(database_url)).await?
        });
        let secondary_storage = Arc::new(adapter.secondary_storage());

        let options = AuthOptions {
            base_url: Some(BaseUrl::Static(config.app_url.clone())),
            base_path: "/api/auth".into(),
            cookie: CookieOptions {
                path: "/".into(),
                ..CookieOptions::default()
            },
            secret: config.better_auth_secret.clone(),
            session: SessionOptions {
                expires_in_seconds: SESSION_SECONDS,
                update_age_seconds: SESSION_UPDATE_SECONDS,
                ..SessionOptions::default()
            },
            trusted_origins: config.cors_origins.clone(),
            ..AuthOptions::default()
        };
        let primary = Arc::new(ScryptPhcPasswordProvider::new(
            options.password_hash.clone(),
        )) as Arc<dyn better_auth::PasswordProvider>;
        let legacy =
            Arc::new(StrangerTvLegacyPasswordProvider) as Arc<dyn better_auth::PasswordProvider>;
        let password_provider = Arc::new(CompositePasswordProvider::new(primary, [legacy]));

        let context = better_auth::AuthContext::builder(options)
            .database(Arc::clone(&adapter) as Arc<dyn DbAdapter>)
            .secondary_storage(Some(
                Arc::clone(&secondary_storage) as Arc<dyn better_auth::core::SecondaryStorage>
            ))
            .password_provider(password_provider)
            .build()
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let credentials = CredentialService::new(context.clone());
        let sessions = SessionService::new(context.clone())
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;

        Ok(Self {
            context,
            credentials,
            sessions,
            adapter,
            secondary_storage,
        })
    }

    /// Resolve the deployment database target using the same development
    /// fallback and production guard as `Db::connect`.
    pub async fn connect_from_env(config: &Config) -> anyhow::Result<Self> {
        let database_url = database_url_from_env(config)?;
        Self::connect(config, &database_url).await
    }

    /// Apply Better Auth's core schema and secondary-storage table. This is
    /// intentionally explicit and is not called by `connect` or server main.
    pub async fn apply_migrations(&self) -> anyhow::Result<()> {
        self.adapter
            .apply_migrations(&self.context.migration_plan())
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        self.secondary_storage
            .migrate()
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        Ok(())
    }

    /// Build a cookie-removal response without touching the Better Auth
    /// tables. This keeps legacy-only rollback deployments functional when a
    /// stale Better Auth cookie is presented before the explicit schema
    /// migration has run.
    pub fn removal_cookie(&self, secure_cookie: bool) -> better_auth::AuthCookie {
        let name = better_auth::session_cookie_name(&self.context.options.cookie, secure_cookie);
        better_auth::AuthCookie::removal_with_options(
            name,
            secure_cookie,
            &self.context.options.cookie,
        )
    }

    /// Mirror the existing StrangerTV verification endpoint into an imported
    /// Better Auth identity when the bridge schema is available.
    pub async fn mark_email_verified(&self, user_id: i64) -> anyhow::Result<()> {
        self.adapter
            .update_where(
                "user",
                Query::new().eq("id", user_id.to_string()),
                serde_json::json!({ "email_verified": true }),
            )
            .await
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!(error.to_string()))
    }

    /// Check whether an imported credential account exists. The adapter error
    /// is deliberately preserved so callers can distinguish a missing account
    /// from an auth schema that has not been migrated yet.
    pub async fn credential_account_exists(&self, user_id: i64) -> anyhow::Result<bool> {
        self.adapter
            .find_one(
                "account",
                Query::new().eq("id", format!("{user_id}:credential")),
            )
            .await
            .map(|record| record.is_some())
            .map_err(|error| anyhow::anyhow!(error.to_string()))
    }

    /// Report whether the imported Better Auth credential still contains the
    /// legacy StrangerTV representation. The login bridge uses this to emit
    /// the migration counters before Better Auth transparently rehashes it.
    pub async fn credential_uses_legacy_hash(&self, user_id: i64) -> anyhow::Result<bool> {
        let Some(record) = self
            .adapter
            .find_one(
                "account",
                Query::new().eq("id", format!("{user_id}:credential")),
            )
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?
        else {
            return Ok(false);
        };
        Ok(record
            .get("password_hash")
            .and_then(serde_json::Value::as_str)
            .is_some_and(is_legacy_hash_format))
    }

    /// Compensating cleanup for a StrangerTV signup that created the Better
    /// Auth credential but failed before the public session was returned.
    pub async fn delete_credential_user(&self, user_id: i64) -> anyhow::Result<()> {
        self.adapter
            .transaction(vec![
                better_auth::core::DbOperation::DeleteWhere {
                    table: "account".into(),
                    query: Query::new().eq("user_id", user_id.to_string()),
                },
                better_auth::core::DbOperation::DeleteWhere {
                    table: "user".into(),
                    query: Query::new().eq("id", user_id.to_string()),
                },
            ])
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))
    }

    /// Update an imported credential through Better Auth's configured hash
    /// provider and revoke every Better Auth session for the identity. The
    /// legacy reset-token table remains the bridge token store until all
    /// existing reset links have aged out.
    pub async fn reset_credential_password(
        &self,
        user_id: i64,
        password: &str,
    ) -> anyhow::Result<bool> {
        let account_id = format!("{user_id}:credential");
        let Some(_) = self
            .adapter
            .find_one("account", Query::new().eq("id", account_id.clone()))
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?
        else {
            return Ok(false);
        };
        let password_hash = self
            .context
            .password_provider
            .hash(password)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        self.adapter
            .update_where(
                "account",
                Query::new().eq("id", account_id),
                serde_json::json!({ "password_hash": password_hash }),
            )
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        self.sessions
            .revoke_all_for_user(&user_id.to_string())
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        self.context
            .after_password_change(&user_id.to_string())
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        Ok(true)
    }
}

/// Resolve the deployment target without opening it. Both the server and the
/// explicit migration binaries use this policy so a production command cannot
/// silently fall back to a local database.
pub fn database_url_from_env(config: &Config) -> anyhow::Result<String> {
    match std::env::var("TURSO_DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => Ok(url),
        _ if !config.is_prod => Ok(DEVELOPMENT_DATABASE_URL.into()),
        _ => anyhow::bail!(
            "TURSO_DATABASE_URL is required in production. For a persistent local database set TURSO_DATABASE_URL=file:/data/local.db"
        ),
    }
}

/// Open the legacy StrangerTV database without applying either schema. The
/// importer uses this handle for read-only source rows and the Better Auth
/// adapter for destination checks/writes.
#[allow(dead_code)]
pub async fn open_legacy_database(config: &Config) -> anyhow::Result<LegacyDatabase> {
    let url = database_url_from_env(config)?;
    let auth_token = std::env::var("TURSO_AUTH_TOKEN").unwrap_or_default();
    if is_remote_url(&url) {
        if auth_token.trim().is_empty() {
            anyhow::bail!("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is remote");
        }
    } else if let Some(path) = url.strip_prefix("file:") {
        if let Some(parent) = std::path::Path::new(path).parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                anyhow::bail!("database directory does not exist: {}", parent.display());
            }
        }
    }

    let database = if is_remote_url(&url) {
        Builder::new_remote(url, auth_token).build().await?
    } else {
        Builder::new_local(local_path(&url)).build().await?
    };
    let conn = database.connect()?;
    Ok(LegacyDatabase {
        _database: database,
        conn,
    })
}

fn is_remote_url(url: &str) -> bool {
    ["libsql://", "http://", "https://", "ws://", "wss://"]
        .iter()
        .any(|scheme| url.starts_with(scheme))
}

fn local_path(url: &str) -> String {
    url.strip_prefix("file:").unwrap_or(url).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use better_auth::core::{DbAdapter, Query};
    use better_auth::{EmailPasswordService, ImportCredential, SignInInput};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn construction_does_not_apply_better_auth_schema() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("stranger-better-auth-{suffix}.db"));
        let url = format!("file:{}", path.display());
        let mut config = Config::from_env();
        config.better_auth_secret = "test-secret-that-is-at-least-32-bytes-long".into();

        let state = BetterAuthState::connect_with(&config, &url, "")
            .await
            .expect("Better Auth infrastructure connects");
        assert_eq!(
            state.context.options.session.expires_in_seconds,
            SESSION_SECONDS
        );
        assert!(state.adapter.find_many("user", Query::new()).await.is_err());
        let legacy_hash = include_str!("../../tests/fixtures/node-password-hash.txt");
        let verification = state
            .context
            .password_provider
            .verify("password12", legacy_hash.trim())
            .await
            .expect("configured composite provider");
        assert!(verification.valid);
        assert!(verification.needs_rehash);

        drop(state);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn legacy_sign_in_rehashes_only_the_better_auth_account() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("stranger-better-auth-rehash-{suffix}.db"));
        let url = format!("file:{}", path.display());
        let mut config = Config::from_env();
        config.better_auth_secret = "test-secret-that-is-at-least-32-bytes-long".into();
        let state = BetterAuthState::connect_with(&config, &url, "")
            .await
            .expect("Better Auth infrastructure connects");
        state.apply_migrations().await.expect("auth schema");

        let legacy_hash = include_str!("../../tests/fixtures/node-password-hash.txt")
            .trim()
            .to_owned();
        state
            .credentials
            .import(ImportCredential {
                id: Some("42".into()),
                email: "compat@example.com".into(),
                name: "compat".into(),
                email_verified: false,
                password_hash: legacy_hash.clone(),
                additional_fields: serde_json::Map::new(),
            })
            .await
            .expect("legacy credential import");
        let imported = state
            .adapter
            .find_one("account", Query::new().eq("id", "42:credential"))
            .await
            .expect("imported account lookup")
            .expect("imported account");
        assert_eq!(
            imported["password_hash"].as_str(),
            Some(legacy_hash.as_str()),
            "import must preserve the source hash byte-for-byte"
        );

        let service = EmailPasswordService::new(state.context.clone()).expect("email service");
        let result = service
            .sign_in(
                SignInInput {
                    email: "compat@example.com".into(),
                    password: "password12".into(),
                },
                false,
            )
            .await
            .expect("legacy password sign-in");
        assert_eq!(result.user.id, "42");

        let account = state
            .adapter
            .find_one("account", Query::new().eq("id", "42:credential"))
            .await
            .expect("account lookup")
            .expect("account exists");
        let replacement = account["password_hash"].as_str().expect("new hash");
        assert_ne!(replacement, legacy_hash);
        assert!(replacement.starts_with("$scrypt$"));

        drop(state);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn resetting_an_imported_credential_rehashes_and_revokes_better_auth_sessions() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("stranger-better-auth-reset-{suffix}.db"));
        let url = format!("file:{}", path.display());
        let mut config = Config::from_env();
        config.better_auth_secret = "test-secret-that-is-at-least-32-bytes-long".into();
        let state = BetterAuthState::connect_with(&config, &url, "")
            .await
            .expect("Better Auth infrastructure connects");
        state.apply_migrations().await.expect("auth schema");
        state
            .credentials
            .import(ImportCredential {
                id: Some("42".into()),
                email: "reset@example.com".into(),
                name: "Reset".into(),
                email_verified: false,
                password_hash: state
                    .context
                    .password_provider
                    .hash("oldpassword12")
                    .await
                    .expect("initial hash"),
                additional_fields: serde_json::Map::new(),
            })
            .await
            .expect("credential import");
        let service = EmailPasswordService::new(state.context.clone()).expect("email service");
        let result = service
            .sign_in(
                SignInInput {
                    email: "reset@example.com".into(),
                    password: "oldpassword12".into(),
                },
                false,
            )
            .await
            .expect("session");

        assert!(state
            .reset_credential_password(42, "newpassword12")
            .await
            .expect("password reset"));
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {}", result.session_token)
                .parse()
                .expect("header"),
        );
        assert!(state
            .sessions
            .resolve_with_transport(&headers, false, better_auth::SessionTransport::Bearer)
            .await
            .expect("session resolution")
            .is_none());
        let account = state
            .adapter
            .find_one("account", Query::new().eq("id", "42:credential"))
            .await
            .expect("account lookup")
            .expect("account exists");
        assert!(account["password_hash"]
            .as_str()
            .expect("hash")
            .starts_with("$scrypt$"));

        drop(state);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn a_new_legacy_user_can_be_imported_and_signed_in_after_its_insert() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("stranger-better-auth-signup-{suffix}.db"));
        let url = format!("file:{}", path.display());
        let legacy_database = Builder::new_local(path.to_string_lossy().to_string())
            .build()
            .await
            .expect("legacy database");
        let legacy_conn = legacy_database.connect().expect("legacy connection");
        legacy_conn
            .execute(
                "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, birth_date TEXT)",
                (),
            )
            .await
            .expect("legacy schema");
        legacy_conn
            .execute(
                "INSERT INTO users (email, password_hash, birth_date) VALUES (?, ?, ?)",
                libsql::params![
                    "new@example.com",
                    crate::auth::password::hash_password("password12"),
                    "1990-02-02"
                ],
            )
            .await
            .expect("legacy insert");
        let mut rows = legacy_conn
            .query(
                "SELECT id FROM users WHERE email = ?",
                libsql::params!["new@example.com"],
            )
            .await
            .expect("legacy lookup");
        let row = rows.next().await.expect("row result").expect("user row");
        let user_id: i64 = row.get(0).expect("user id");
        drop(row);
        drop(rows);

        let mut config = Config::from_env();
        config.better_auth_secret = "test-secret-that-is-at-least-32-bytes-long".into();
        let state = BetterAuthState::connect_with(&config, &url, "")
            .await
            .expect("Better Auth connection");
        state.apply_migrations().await.expect("auth schema");
        assert!(!state
            .credential_account_exists(user_id)
            .await
            .expect("account preflight"));
        let password_hash = state
            .context
            .password_provider
            .hash("password12")
            .await
            .expect("Better Auth hash");
        state
            .credentials
            .import(ImportCredential {
                id: Some(user_id.to_string()),
                email: "new@example.com".into(),
                name: "new".into(),
                email_verified: false,
                password_hash,
                additional_fields: serde_json::Map::new(),
            })
            .await
            .expect("credential import");
        let service = EmailPasswordService::new(state.context.clone()).expect("email service");
        let result = service
            .sign_in(
                SignInInput {
                    email: "new@example.com".into(),
                    password: "password12".into(),
                },
                false,
            )
            .await
            .expect("new account sign-in");
        assert_eq!(result.user.id, user_id.to_string());

        drop(state);
        drop(legacy_conn);
        drop(legacy_database);
        let _ = std::fs::remove_file(path);
    }
}

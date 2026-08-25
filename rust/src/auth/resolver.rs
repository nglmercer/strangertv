//! One application-facing authentication resolver for the migration bridge.
//!
//! Better Auth and StrangerTV sessions coexist here. Handlers receive only
//! the canonical numeric application identity; they do not need to know which
//! session implementation produced it.

use axum::http::HeaderMap;

use crate::auth::better_auth::BetterAuthState;
use crate::auth::session::{user_from_id, user_from_token, UserRow};
use crate::config::Config;
use crate::db::Db;
use crate::infra::http::get_bearer;
use crate::AppState;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthenticatedUser {
    pub user_id: i64,
}

/// Resolve in the migration order:
///
/// 1. Better Auth cookie
/// 2. Better Auth bearer
/// 3. legacy StrangerTV bearer
pub async fn resolve_authenticated_user(
    headers: &HeaderMap,
    state: &AppState,
) -> anyhow::Result<Option<AuthenticatedUser>> {
    resolve_authenticated_user_with(headers, &state.db, &state.better_auth, &state.config).await
}

/// Testable/dependency-injection-friendly form of the resolver. Production
/// handlers normally use [`resolve_authenticated_user`] so they cannot pass a
/// mismatched legacy database and Better Auth state accidentally.
pub async fn resolve_authenticated_user_with(
    headers: &HeaderMap,
    db: &Db,
    better_auth: &BetterAuthState,
    config: &Config,
) -> anyhow::Result<Option<AuthenticatedUser>> {
    let secure_cookie = config.app_url.starts_with("https://");

    if let Some(principal) = resolve_better_auth_cookie(headers, better_auth, secure_cookie).await?
    {
        if let Some(user) = application_user_from_better_auth(db, &principal.user.id).await? {
            crate::infra::metrics::inc("auth_resolver_better_auth_cookie", 1);
            return Ok(Some(user));
        }
    }

    if let Some(principal) = resolve_better_auth_bearer(headers, better_auth, secure_cookie).await?
    {
        if let Some(user) = application_user_from_better_auth(db, &principal.user.id).await? {
            crate::infra::metrics::inc("auth_resolver_better_auth_bearer", 1);
            return Ok(Some(user));
        }
    }

    let Some(token) = get_bearer(headers) else {
        return Ok(None);
    };
    let user = user_from_token(db, Some(&token)).await?;
    if user.is_some() {
        crate::infra::metrics::inc("auth_resolver_legacy_bearer", 1);
        crate::infra::metrics::inc("legacy_session_fallback", 1);
    }
    Ok(user.map(|user| AuthenticatedUser { user_id: user.id }))
}

/// Resolve the canonical application row for handlers that need profile data.
/// Keeping this conversion next to the implementation-level resolver prevents
/// route modules from accidentally reintroducing token-specific branches.
pub async fn resolve_authenticated_user_row(
    headers: &HeaderMap,
    state: &AppState,
) -> anyhow::Result<Option<UserRow>> {
    let Some(authenticated) = resolve_authenticated_user(headers, state).await? else {
        return Ok(None);
    };
    user_from_id(&state.db, authenticated.user_id).await
}

async fn resolve_better_auth_cookie(
    headers: &HeaderMap,
    better_auth: &BetterAuthState,
    secure_cookie: bool,
) -> anyhow::Result<Option<better_auth::AuthPrincipal>> {
    match better_auth.sessions.resolve(headers, secure_cookie).await {
        Ok(principal) => Ok(principal),
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => Ok(None),
        Err(error) => Err(anyhow::anyhow!(error.to_string())),
    }
}

async fn resolve_better_auth_bearer(
    headers: &HeaderMap,
    better_auth: &BetterAuthState,
    secure_cookie: bool,
) -> anyhow::Result<Option<better_auth::AuthPrincipal>> {
    match better_auth
        .sessions
        .resolve_with_transport(
            headers,
            secure_cookie,
            better_auth::SessionTransport::Bearer,
        )
        .await
    {
        Ok(principal) => Ok(principal),
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => Ok(None),
        Err(error) => Err(anyhow::anyhow!(error.to_string())),
    }
}

async fn application_user_from_better_auth(
    db: &Db,
    better_auth_id: &str,
) -> anyhow::Result<Option<AuthenticatedUser>> {
    let Ok(user_id) = better_auth_id.parse::<i64>() else {
        return Ok(None);
    };
    if user_from_id(db, user_id).await?.is_some() {
        Ok(Some(AuthenticatedUser { user_id }))
    } else {
        Ok(None)
    }
}

pub fn better_auth_schema_not_ready(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("no such table")
        || message.contains("does not exist")
        || message.contains("table not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::better_auth::BetterAuthState;
    use crate::auth::session::create_session;
    use crate::db::Db;
    use better_auth::{EmailPasswordService, ImportCredential, SignInInput};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn only_database_schema_absence_is_soft_fallback() {
        assert!(better_auth_schema_not_ready(
            "SQLite failure: no such table: user"
        ));
        assert!(better_auth_schema_not_ready("table not found"));
        assert!(!better_auth_schema_not_ready("remote database unavailable"));
    }

    #[tokio::test]
    async fn cookie_bearer_and_legacy_bearer_resolve_the_same_numeric_identity() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("stranger-resolver-{suffix}.db"));
        let url = format!("file:{}", path.display());
        let db = Db::open(&url).await.expect("legacy database");
        db.migrate().await.expect("legacy schema");
        db.conn()
            .execute(
                "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                libsql::params![42_i64, "resolver@example.com", "unused"],
            )
            .await
            .expect("legacy user");

        let mut config = Config::from_env();
        config.app_url = "http://localhost:5173".into();
        config.better_auth_secret = "test-secret-that-is-at-least-32-bytes-long".into();
        let better_auth = BetterAuthState::connect_with(&config, &url, "")
            .await
            .expect("Better Auth connection");

        // Before the explicit auth migration, a legacy session still resolves
        // through the final fallback and does not require Better Auth tables.
        let legacy_token = create_session(&db, 42).await.expect("legacy session");
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {legacy_token}").parse().expect("header"),
        );
        assert_eq!(
            resolve_authenticated_user_with(&headers, &db, &better_auth, &config)
                .await
                .expect("legacy resolution")
                .expect("legacy principal")
                .user_id,
            42
        );

        better_auth.apply_migrations().await.expect("auth schema");
        let legacy_hash = include_str!("../../tests/fixtures/node-password-hash.txt")
            .trim()
            .to_owned();
        better_auth
            .credentials
            .import(ImportCredential {
                id: Some("42".into()),
                email: "resolver@example.com".into(),
                name: "Resolver".into(),
                email_verified: true,
                password_hash: legacy_hash,
                additional_fields: serde_json::Map::new(),
            })
            .await
            .expect("imported identity");
        let email = EmailPasswordService::new(better_auth.context.clone()).expect("email service");
        let result = email
            .sign_in(
                SignInInput {
                    email: "resolver@example.com".into(),
                    password: "password12".into(),
                },
                false,
            )
            .await
            .expect("Better Auth session");

        let cookie_pair = result
            .cookie
            .to_set_cookie_header()
            .split(';')
            .next()
            .expect("cookie pair")
            .to_owned();
        let mut cookie_headers = HeaderMap::new();
        cookie_headers.insert(
            axum::http::header::COOKIE,
            cookie_pair.parse().expect("cookie header"),
        );
        assert_eq!(
            resolve_authenticated_user_with(&cookie_headers, &db, &better_auth, &config)
                .await
                .expect("cookie resolution")
                .expect("cookie principal")
                .user_id,
            42
        );

        let mut better_bearer = HeaderMap::new();
        better_bearer.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", result.session_token)
                .parse()
                .expect("Better Auth bearer"),
        );
        assert_eq!(
            resolve_authenticated_user_with(&better_bearer, &db, &better_auth, &config)
                .await
                .expect("bearer resolution")
                .expect("bearer principal")
                .user_id,
            42
        );

        drop(better_auth);
        drop(db);
        let _ = std::fs::remove_file(path);
    }
}

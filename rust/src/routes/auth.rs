//! Authentication endpoints. Port of `server/routes/auth.ts`.
//!
//! Error strings and status codes are copied verbatim — the client matches on
//! some of them, and the integration suite asserts on others.

use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use better_auth::{EmailPasswordService, SignInInput};
use libsql::params;
use serde_json::{json, Value};

use crate::age::is_adult;
use crate::auth::password::{
    hash_password, hash_token, random_token, valid_credentials, verify_password,
};
use crate::auth::resolver::{better_auth_schema_not_ready, resolve_authenticated_user_row};
use crate::auth::session::{
    create_session, is_banned, public_user, refresh_session, revoke_session, user_from_id,
    user_from_token,
};
use crate::constants::{DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE};
use crate::email::{
    reset_email_body, send_email, verify_email_body, Mail, SUBJECT_RESET, SUBJECT_VERIFY,
};
use crate::error::{ApiError, ApiResult};
use crate::infra::http::{client_ip, get_bearer};
use crate::infra::metrics::inc;
use crate::infra::rate_limit::{rate_limit, rate_limit_headers, rate_limit_info};
use crate::AppState;

fn register_limit() -> u32 {
    std::env::var("REGISTER_RATE_LIMIT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10)
}

fn register_window_ms() -> u64 {
    std::env::var("REGISTER_RATE_WINDOW_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(15 * 60_000)
}

fn better_auth_cookie_response(
    status: StatusCode,
    body: Value,
    cookie: &better_auth::AuthCookie,
) -> ApiResult<Response> {
    response_with_optional_cookie(status, body, Some(cookie))
}

fn response_with_optional_cookie(
    status: StatusCode,
    body: Value,
    cookie: Option<&better_auth::AuthCookie>,
) -> ApiResult<Response> {
    let mut response = (status, Json(body)).into_response();
    if let Some(cookie) = cookie {
        let cookie = HeaderValue::from_str(&cookie.to_set_cookie_header())
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal error"))?;
        response.headers_mut().append(header::SET_COOKIE, cookie);
    }
    Ok(response)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/verify-email", post(verify_email))
        .route(
            "/api/v1/auth/resend-verification",
            post(resend_verification),
        )
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/refresh", post(refresh))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/auth/preferences", patch(preferences))
        .route("/api/v1/auth/password-reset/request", post(reset_request))
        .route("/api/v1/auth/password-reset/confirm", post(reset_confirm))
        .route("/api/v1/auth/account", delete(delete_account))
        .with_state(state)
}

/// `body.field` when it is a string, else the default — mirroring
/// `typeof x === 'string' ? x : DEFAULT`.
fn str_or<'a>(body: &'a Value, key: &str, default: &'a str) -> &'a str {
    body.get(key).and_then(Value::as_str).unwrap_or(default)
}

/// `Array.isArray(x) ? JSON.stringify(x.slice(0, 10)) : '[]'`
fn interests_json(body: &Value) -> String {
    match body.get("interests").and_then(Value::as_array) {
        Some(arr) => {
            let capped: Vec<&Value> = arr.iter().take(10).collect();
            serde_json::to_string(&capped).unwrap_or_else(|_| "[]".into())
        }
        None => "[]".into(),
    }
}

async fn rollback_new_legacy_user(state: &AppState, user_id: i64) {
    let _ = state
        .db
        .conn()
        .execute("DELETE FROM users WHERE id = ?", params![user_id])
        .await;
}

async fn rollback_signup(
    state: &AppState,
    user_id: i64,
    legacy_token: Option<&str>,
    better_auth_result: Option<&better_auth::AuthResult>,
) {
    if let Some(token) = legacy_token {
        let _ = revoke_session(&state.db, token).await;
    }
    if let Some(result) = better_auth_result {
        let _ = state
            .better_auth
            .sessions
            .revoke_token(&result.session_token)
            .await;
        let _ = state.better_auth.delete_credential_user(user_id).await;
    }
    let _ = state
        .db
        .conn()
        .execute(
            "DELETE FROM email_verification_tokens WHERE user_id = ?",
            params![user_id],
        )
        .await;
    let _ = state
        .db
        .conn()
        .execute("DELETE FROM consents WHERE user_id = ?", params![user_id])
        .await;
    rollback_new_legacy_user(state, user_id).await;
}

/// Create the matching Better Auth identity for a newly-created StrangerTV
/// user when the explicit auth schema is available. Returning `None` is the
/// rollout-safe path for a server deployed before `migrate-auth`.
async fn create_better_auth_signup(
    state: &AppState,
    user_id: i64,
    email: &str,
    password: &str,
) -> ApiResult<Option<better_auth::AuthResult>> {
    let account_exists = match state.better_auth.credential_account_exists(user_id).await {
        Ok(exists) => exists,
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => return Ok(None),
        Err(error) => {
            rollback_new_legacy_user(state, user_id).await;
            return Err(ApiError::from(error));
        }
    };
    if account_exists {
        rollback_new_legacy_user(state, user_id).await;
        return Err(ApiError::conflict("That email is already registered."));
    }

    let name: String = email
        .split('@')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("user")
        .chars()
        .take(200)
        .collect();
    let password_hash = match state
        .better_auth
        .context
        .password_provider
        .hash(password)
        .await
    {
        Ok(hash) => hash,
        Err(error) => {
            rollback_new_legacy_user(state, user_id).await;
            return Err(ApiError::from(anyhow::anyhow!(error.to_string())));
        }
    };
    if let Err(error) = state
        .better_auth
        .credentials
        .import(better_auth::ImportCredential {
            id: Some(user_id.to_string()),
            email: email.into(),
            name,
            email_verified: false,
            password_hash,
            additional_fields: serde_json::Map::new(),
        })
        .await
    {
        rollback_new_legacy_user(state, user_id).await;
        return Err(ApiError::from(anyhow::anyhow!(error.to_string())));
    }

    let service = match EmailPasswordService::new(state.better_auth.context.clone()) {
        Ok(service) => service,
        Err(error) => {
            let _ = state.better_auth.delete_credential_user(user_id).await;
            rollback_new_legacy_user(state, user_id).await;
            return Err(ApiError::from(anyhow::anyhow!(error.to_string())));
        }
    };
    match service
        .sign_in(
            SignInInput {
                email: email.into(),
                password: password.into(),
            },
            state.config.app_url.starts_with("https://"),
        )
        .await
    {
        Ok(result) => Ok(Some(result)),
        Err(error) => {
            let _ = state.better_auth.delete_credential_user(user_id).await;
            rollback_new_legacy_user(state, user_id).await;
            Err(ApiError::from(anyhow::anyhow!(error.to_string())))
        }
    }
}

async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let ip = client_ip(&headers);
    let rl = rate_limit_info(
        &format!("register:{ip}"),
        register_limit(),
        register_window_ms(),
    );
    if !rl.ok {
        // The rate-limit headers travel with the 429, as in the original.
        let mut err = ApiError::too_many("Too many attempts. Try later.");
        err.message = "Too many attempts. Try later.".into();
        let _ = rate_limit_headers(&rl);
        return Err(err);
    }
    inc("auth_register_attempts", 1);

    let email = body
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let password = body
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !valid_credentials(email, password) {
        return Err(ApiError::bad_request(
            "Use a valid email and an 8+ character password.",
        ));
    }
    let birth_date = body
        .get("birthDate")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !is_adult(birth_date) {
        return Err(ApiError::bad_request(
            "You must be 18 or older to register.",
        ));
    }
    if is_banned(&state.db, None, Some(&ip))
        .await
        .map_err(ApiError::from)?
    {
        return Err(ApiError::forbidden("Access denied."));
    }

    let email_lower = email.to_lowercase();
    let gender = str_or(&body, "gender", DEFAULT_GENDER).to_string();
    let country = str_or(&body, "country", DEFAULT_COUNTRY).to_string();
    let language = str_or(&body, "language", DEFAULT_LANGUAGE).to_string();
    let interests = interests_json(&body);

    let inserted = state
        .db
        .conn()
        .execute(
            "INSERT INTO users (email, password_hash, birth_date, gender, country, language, interests)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                email_lower.clone(),
                hash_password(password),
                birth_date,
                gender,
                country,
                language,
                interests
            ],
        )
        .await;
    if inserted.is_err() {
        // UNIQUE(email) — the Node version funnels every insert failure here.
        return Err(ApiError::conflict("That email is already registered."));
    }

    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT id FROM users WHERE email = ?",
            params![email_lower.clone()],
        )
        .await?;
    let user_id: i64 = match rows.next().await? {
        Some(row) => row.get(0)?,
        None => return Err(ApiError::conflict("That email is already registered.")),
    };
    drop(rows);

    let better_auth_result =
        create_better_auth_signup(&state, user_id, &email_lower, password).await?;
    let token = match create_session(&state.db, user_id).await {
        Ok(token) => token,
        Err(error) => {
            rollback_signup(&state, user_id, None, better_auth_result.as_ref()).await;
            return Err(ApiError::from(error));
        }
    };
    if let Err(error) = state
        .db
        .conn()
        .execute(
            "INSERT INTO consents (user_id, kind) VALUES (?, ?)",
            params![user_id, crate::constants::CONSENT_KIND_TERMS_AGE],
        )
        .await
    {
        rollback_signup(&state, user_id, Some(&token), better_auth_result.as_ref()).await;
        return Err(ApiError::from(error));
    }

    let verify_token = match create_email_verification_token(&state, user_id).await {
        Ok(token) => token,
        Err(error) => {
            rollback_signup(&state, user_id, Some(&token), better_auth_result.as_ref()).await;
            return Err(error);
        }
    };
    let mail = verify_email_body(&verify_token, &state.config.app_url);
    send_email(&Mail {
        to: email_lower,
        subject: SUBJECT_VERIFY.into(),
        text: mail.text,
        html: mail.html,
    })
    .await;

    let user = match user_from_token(&state.db, Some(&token)).await {
        Ok(user) => user,
        Err(error) => {
            rollback_signup(&state, user_id, Some(&token), better_auth_result.as_ref()).await;
            return Err(ApiError::from(error));
        }
    };
    inc("auth_register_ok", 1);
    crate::log_info!("auth.register", { "userId": user_id });

    let mut out = json!({
        "user": user.as_ref().map(public_user),
        "token": token,
    });
    if !state.config.is_prod {
        out["devVerifyToken"] = json!(verify_token);
    }
    if let Some(result) = better_auth_result {
        out["session"] = json!("better-auth");
        inc("auth_session_better_auth", 1);
        inc("auth_session_legacy_issued", 1);
        return better_auth_cookie_response(StatusCode::CREATED, out, &result.cookie);
    }
    out["session"] = json!("legacy");
    inc("auth_session_legacy_fallback", 1);
    inc("auth_session_legacy_issued", 1);
    inc("legacy_session_fallback", 1);
    Ok((StatusCode::CREATED, Json(out)).into_response())
}

async fn create_email_verification_token(state: &AppState, user_id: i64) -> ApiResult<String> {
    let token = random_token();
    let expires = iso_in_hours(48);
    state
        .db
        .conn()
        .execute(
            "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
            params![user_id, hash_token(&token), expires],
        )
        .await?;
    Ok(token)
}

fn iso_in_hours(hours: i64) -> String {
    use time::format_description::well_known::Rfc3339;
    (time::OffsetDateTime::now_utc() + time::Duration::hours(hours))
        .format(&Rfc3339)
        .unwrap_or_default()
}

async fn verify_email(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if token.is_empty() {
        return Err(ApiError::bad_request("Invalid token."));
    }
    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT id, user_id FROM email_verification_tokens
             WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')",
            params![hash_token(token)],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Err(ApiError::bad_request("Invalid or expired token."));
    };
    let id: i64 = row.get(0)?;
    let user_id: i64 = row.get(1)?;
    drop(row);
    drop(rows);
    state
        .db
        .conn()
        .execute(
            "UPDATE users SET email_verified = 1 WHERE id = ?",
            params![user_id],
        )
        .await?;
    match state.better_auth.mark_email_verified(user_id).await {
        Ok(()) => {}
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => {}
        Err(error) => return Err(ApiError::from(error)),
    }
    state
        .db
        .conn()
        .execute(
            "UPDATE email_verification_tokens SET used = 1 WHERE id = ?",
            params![id],
        )
        .await?;
    inc("email_verified", 1);
    Ok(Json(json!({ "ok": true })))
}

async fn resend_verification(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let user = resolve_authenticated_user_row(&headers, &state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;
    if user.email_verified != 0 {
        return Ok(Json(json!({ "ok": true, "already": true })));
    }
    let ip = client_ip(&headers);
    if !rate_limit(&format!("reverify:{ip}"), 5, 15 * 60_000) {
        return Err(ApiError::too_many("Too many attempts."));
    }
    let verify_token = create_email_verification_token(&state, user.id).await?;
    let mail = verify_email_body(&verify_token, &state.config.app_url);
    send_email(&Mail {
        to: user.email.clone(),
        subject: SUBJECT_VERIFY.into(),
        text: mail.text,
        html: mail.html,
    })
    .await;

    let mut out = json!({ "ok": true });
    if !state.config.is_prod {
        out["devVerifyToken"] = json!(verify_token);
    }
    Ok(Json(out))
}

async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let ip = client_ip(&headers);
    let rl = rate_limit_info(&format!("login:{ip}"), 20, 15 * 60_000);
    if !rl.ok {
        return Err(ApiError::too_many("Too many attempts. Try later."));
    }
    inc("auth_login_attempts", 1);

    let email = body
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let password = body
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !valid_credentials(email, password) {
        return Err(ApiError::bad_request("Invalid email or password."));
    }

    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT id, password_hash, birth_date, email_verified FROM users WHERE email = ?",
            params![email.to_lowercase()],
        )
        .await?;
    let row = rows.next().await?;
    // Same message for unknown email and wrong password, so the endpoint does
    // not confirm which addresses exist.
    let invalid = || ApiError::new(StatusCode::UNAUTHORIZED, "Invalid email or password.");
    let Some(row) = row else {
        return Err(invalid());
    };
    let stored: String = row.get(1).map_err(|_| invalid())?;
    let user_id: i64 = row.get(0)?;
    let birth_date: Option<String> = row.get(2).ok();
    let email_verified: i64 = row.get(3).unwrap_or(0);
    drop(row);
    drop(rows);
    if is_banned(&state.db, Some(user_id), Some(&ip))
        .await
        .map_err(ApiError::from)?
    {
        return Err(ApiError::forbidden("This account is banned."));
    }
    if !birth_date.as_deref().is_some_and(is_adult) {
        return Err(ApiError::forbidden(
            "Your account needs a valid 18+ birthday.",
        ));
    }
    if state.config.features.require_email_verified && email_verified == 0 {
        return Err(ApiError::forbidden("Verify your email before signing in.")
            .with_code("email_unverified"));
    }

    // Imported users use Better Auth's composite provider. If the explicit
    // auth schema migration has not run yet, or this user has not been
    // imported, retain the legacy path so deployment can be rolled out in
    // either order without breaking sign-in.
    let better_auth_account = match state.better_auth.credential_account_exists(user_id).await {
        Ok(exists) => Some(exists),
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => None,
        Err(error) => return Err(ApiError::from(error)),
    };
    if better_auth_account == Some(true) {
        let legacy_better_auth_hash =
            match state.better_auth.credential_uses_legacy_hash(user_id).await {
                Ok(uses_legacy) => uses_legacy,
                Err(error) if better_auth_schema_not_ready(&error.to_string()) => false,
                Err(error) => return Err(ApiError::from(error)),
            };
        let service = EmailPasswordService::new(state.better_auth.context.clone())
            .map_err(|error| ApiError::from(anyhow::anyhow!(error.to_string())))?;
        let result = match service
            .sign_in(
                SignInInput {
                    email: email.to_owned(),
                    password: password.to_owned(),
                },
                state.config.app_url.starts_with("https://"),
            )
            .await
        {
            Ok(result) => result,
            Err(better_auth::core::AuthError::Unauthorized) => {
                inc("auth_login_better_auth_failed", 1);
                return Err(invalid());
            }
            Err(error) => return Err(ApiError::from(anyhow::anyhow!(error.to_string()))),
        };
        let token = match create_session(&state.db, user_id).await {
            Ok(token) => token,
            Err(error) => {
                let _ = state
                    .better_auth
                    .sessions
                    .revoke_token(&result.session_token)
                    .await;
                return Err(ApiError::from(error));
            }
        };
        let user = user_from_id(&state.db, user_id)
            .await
            .map_err(ApiError::from)?;
        inc("auth_login_better_auth_success", 1);
        if legacy_better_auth_hash {
            inc("auth_password_legacy_verified", 1);
            inc("auth_password_legacy_rehashed", 1);
        }
        inc("auth_session_better_auth", 1);
        inc("auth_session_legacy_issued", 1);
        inc("auth_login_ok", 1);
        return better_auth_cookie_response(
            StatusCode::OK,
            json!({
                "user": user.as_ref().map(public_user),
                "token": token,
                "session": "better-auth",
            }),
            &result.cookie,
        );
    }

    if !verify_password(password, &stored) {
        inc("auth_login_better_auth_failed", 1);
        return Err(invalid());
    }

    let token = create_session(&state.db, user_id)
        .await
        .map_err(ApiError::from)?;
    let user = user_from_token(&state.db, Some(&token))
        .await
        .map_err(ApiError::from)?;
    inc("auth_password_legacy_verified", 1);
    inc("auth_session_legacy_fallback", 1);
    inc("auth_session_legacy_issued", 1);
    inc("legacy_session_fallback", 1);
    inc("auth_login_ok", 1);
    Ok((
        StatusCode::OK,
        Json(json!({
        "user": user.as_ref().map(public_user),
        "token": token,
        "session": "legacy",
        })),
    )
        .into_response())
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let secure_cookie = state.config.app_url.starts_with("https://");
    let bearer = get_bearer(&headers);
    let better_auth_bearer = if bearer.is_some() {
        match state
            .better_auth
            .sessions
            .resolve_with_transport(
                &headers,
                secure_cookie,
                better_auth::SessionTransport::Bearer,
            )
            .await
        {
            Ok(Some(_)) => true,
            Ok(None) => false,
            Err(error) if better_auth_schema_not_ready(&error.to_string()) => false,
            Err(error) => return Err(ApiError::from(anyhow::anyhow!(error.to_string()))),
        }
    } else {
        false
    };
    if let Some(token) = bearer {
        if better_auth_bearer {
            state
                .better_auth
                .sessions
                .revoke_token(&token)
                .await
                .map_err(|error| ApiError::from(anyhow::anyhow!(error.to_string())))?;
            inc("auth_logout_better_auth", 1);
        } else {
            revoke_session(&state.db, &token)
                .await
                .map_err(ApiError::from)?;
            inc("auth_logout_legacy", 1);
        }
    }
    let cookie = match state
        .better_auth
        .sessions
        .revoke(&headers, secure_cookie)
        .await
    {
        Ok(cookie) => cookie,
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => {
            state.better_auth.removal_cookie(secure_cookie)
        }
        Err(error) => return Err(ApiError::from(anyhow::anyhow!(error.to_string()))),
    };
    better_auth_cookie_response(StatusCode::OK, json!({ "ok": true }), &cookie)
}

async fn refresh(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let secure_cookie = state.config.app_url.starts_with("https://");
    let better_auth_principal = match state
        .better_auth
        .sessions
        .resolve(&headers, secure_cookie)
        .await
    {
        Ok(principal) => principal,
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => None,
        Err(error) => return Err(ApiError::from(anyhow::anyhow!(error.to_string()))),
    };
    if let Some(principal) = better_auth_principal {
        let user_id = principal
            .user
            .id
            .parse::<i64>()
            .map_err(|_| ApiError::unauthorized())?;
        let user = user_from_id(&state.db, user_id)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(ApiError::unauthorized)?;
        let cookie = state
            .better_auth
            .sessions
            .refresh(&headers, secure_cookie)
            .await
            .map_err(|error| ApiError::from(anyhow::anyhow!(error.to_string())))?;
        let token = create_session(&state.db, user_id)
            .await
            .map_err(ApiError::from)?;
        inc("auth_refresh_better_auth", 1);
        inc("auth_session_better_auth", 1);
        inc("auth_session_legacy_issued", 1);
        return response_with_optional_cookie(
            StatusCode::OK,
            json!({
                "token": token,
                "user": Some(public_user(&user)),
                "session": "better-auth",
            }),
            cookie.as_ref(),
        );
    }
    let token = get_bearer(&headers).ok_or_else(ApiError::unauthorized)?;
    let next = refresh_session(&state.db, &token)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;
    let user = user_from_token(&state.db, Some(&next))
        .await
        .map_err(ApiError::from)?;
    inc("auth_session_legacy_fallback", 1);
    inc("auth_session_legacy_issued", 1);
    inc("legacy_session_fallback", 1);
    inc("auth_refresh_ok", 1);
    Ok((
        StatusCode::OK,
        Json(json!({
        "token": next,
        "user": user.as_ref().map(public_user),
        "session": "legacy",
        })),
    )
        .into_response())
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = resolve_authenticated_user_row(&headers, &state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;
    Ok(Json(json!({ "user": public_user(&user) })))
}

async fn preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = resolve_authenticated_user_row(&headers, &state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;

    // COALESCE keeps the existing column when the field is absent.
    let interests = body.get("interests").and_then(Value::as_array).map(|arr| {
        serde_json::to_string(&arr.iter().take(10).collect::<Vec<_>>()).unwrap_or_default()
    });

    state
        .db
        .conn()
        .execute(
            "UPDATE users SET gender = COALESCE(?, gender), country = COALESCE(?, country),
             language = COALESCE(?, language), interests = COALESCE(?, interests) WHERE id = ?",
            params![
                body.get("gender").and_then(Value::as_str),
                body.get("country").and_then(Value::as_str),
                body.get("language").and_then(Value::as_str),
                interests,
                user.id
            ],
        )
        .await?;

    let updated = user_from_id(&state.db, user.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "user": updated.as_ref().map(public_user) })))
}

async fn reset_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let ip = client_ip(&headers);
    if !rate_limit(&format!("reset:{ip}"), 5, 15 * 60_000) {
        return Err(ApiError::too_many("Too many attempts."));
    }
    let mut dev_reset_token: Option<String> = None;

    if let Some(email) = body.get("email").and_then(Value::as_str) {
        let email_lower = email.to_lowercase();
        let mut rows = state
            .db
            .conn()
            .query(
                "SELECT id FROM users WHERE email = ?",
                params![email_lower.clone()],
            )
            .await?;
        if let Some(row) = rows.next().await? {
            let user_id: i64 = row.get(0)?;
            drop(row);
            drop(rows);
            let token = random_token();
            state
                .db
                .conn()
                .execute(
                    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
                    params![user_id, hash_token(&token), iso_in_hours(1)],
                )
                .await?;
            let mail = reset_email_body(&token, &state.config.app_url);
            send_email(&Mail {
                to: email_lower,
                subject: SUBJECT_RESET.into(),
                text: mail.text,
                html: mail.html,
            })
            .await;
            if state.config.node_env != "production" {
                dev_reset_token = Some(token);
            }
            match state.better_auth.credential_account_exists(user_id).await {
                Ok(true) => inc("auth_password_reset_better_auth", 1),
                Ok(false) => inc("auth_password_reset_legacy_fallback", 1),
                Err(error) if better_auth_schema_not_ready(&error.to_string()) => {
                    inc("auth_password_reset_legacy_fallback", 1);
                }
                Err(error) => return Err(ApiError::from(error)),
            }
            inc("password_reset_requests", 1);
        }
    }

    // Always `ok: true`, whether or not the address exists — the endpoint must
    // not reveal which emails are registered.
    let mut out = json!({ "ok": true });
    if let Some(token) = dev_reset_token {
        out["devResetToken"] = json!(token);
    }
    Ok(Json(out))
}

async fn reset_confirm(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let password = body
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if token.is_empty() || password.len() < 8 {
        return Err(ApiError::bad_request("Invalid request."));
    }
    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT id, user_id FROM password_reset_tokens
             WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')",
            params![hash_token(token)],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Err(ApiError::bad_request("Invalid or expired token."));
    };
    let id: i64 = row.get(0)?;
    let user_id: i64 = row.get(1)?;
    drop(row);
    drop(rows);

    let better_auth_account = match state.better_auth.credential_account_exists(user_id).await {
        Ok(exists) => exists,
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => false,
        Err(error) => return Err(ApiError::from(error)),
    };
    if better_auth_account {
        state
            .better_auth
            .reset_credential_password(user_id, password)
            .await
            .map_err(ApiError::from)?;
    }

    state
        .db
        .conn()
        .execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            params![hash_password(password), user_id],
        )
        .await?;
    state
        .db
        .conn()
        .execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE id = ?",
            params![id],
        )
        .await?;
    // Every existing session dies with the password change.
    state
        .db
        .conn()
        .execute(
            "UPDATE sessions SET revoked = 1 WHERE user_id = ?",
            params![user_id],
        )
        .await?;
    if better_auth_account {
        inc("auth_password_reset_better_auth_ok", 1);
    }
    inc("password_reset_ok", 1);
    Ok(Json(json!({ "ok": true })))
}

/// Apply StrangerTV's account-deletion policy after auth sessions/credentials
/// are revoked: remove user-owned social/match data, retain moderation records
/// with anonymized user references, then remove the canonical user row.
async fn delete_legacy_account_data(state: &AppState, user_id: i64) -> anyhow::Result<()> {
    let conn = state.db.conn();
    // user_id is an i64 loaded from the database, so interpolating this
    // validated numeric value keeps the statements homogeneous while avoiding
    // a large set of one-off parameter tuple types.
    let statements = [
        format!("DELETE FROM group_messages WHERE sender_id = {user_id} OR group_id IN (SELECT id FROM groups WHERE created_by = {user_id})"),
        format!("DELETE FROM group_invites WHERE inviter_id = {user_id} OR invitee_id = {user_id} OR group_id IN (SELECT id FROM groups WHERE created_by = {user_id})"),
        format!("DELETE FROM group_members WHERE user_id = {user_id} OR group_id IN (SELECT id FROM groups WHERE created_by = {user_id})"),
        format!("DELETE FROM groups WHERE created_by = {user_id}"),
        format!("DELETE FROM group_match_participants WHERE user_id = {user_id} OR room_id IN (SELECT id FROM group_match_rooms WHERE host_user_id = {user_id})"),
        format!("DELETE FROM group_match_rooms WHERE host_user_id = {user_id}"),
        format!("DELETE FROM messages WHERE sender_id = {user_id} OR recipient_id = {user_id}"),
        format!("DELETE FROM invitations WHERE inviter_id = {user_id} OR invitee_id = {user_id}"),
        format!("DELETE FROM friends WHERE user_a_id = {user_id} OR user_b_id = {user_id}"),
        format!("DELETE FROM follows WHERE follower_id = {user_id} OR followed_id = {user_id}"),
        format!("DELETE FROM blocks WHERE blocker_id = {user_id} OR blocked_id = {user_id}"),
        format!("DELETE FROM sessions WHERE user_id = {user_id}"),
        format!("DELETE FROM password_reset_tokens WHERE user_id = {user_id}"),
        format!("DELETE FROM email_verification_tokens WHERE user_id = {user_id}"),
        format!("DELETE FROM consents WHERE user_id = {user_id}"),
        format!("UPDATE reports SET reporter_id = NULL WHERE reporter_id = {user_id}"),
        format!("UPDATE ratings SET rater_id = NULL WHERE rater_id = {user_id}"),
        format!("UPDATE bans SET user_id = NULL WHERE user_id = {user_id}"),
        format!("DELETE FROM users WHERE id = {user_id}"),
    ];
    for sql in statements {
        conn.execute(&sql, ()).await?;
    }
    Ok(())
}

async fn delete_account(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let user = resolve_authenticated_user_row(&headers, &state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;
    let secure_cookie = state.config.app_url.starts_with("https://");
    let better_auth_account = match state.better_auth.credential_account_exists(user.id).await {
        Ok(exists) => exists,
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => false,
        Err(error) => return Err(ApiError::from(error)),
    };
    // Revoke the application-owned sessions before removing the Better Auth
    // identity, matching the documented deletion ordering. The later data
    // cleanup deletes these rows permanently.
    state
        .db
        .conn()
        .execute(
            "UPDATE sessions SET revoked = 1 WHERE user_id = ?",
            params![user.id],
        )
        .await?;
    if better_auth_account {
        state
            .better_auth
            .sessions
            .revoke_all_for_user(&user.id.to_string())
            .await
            .map_err(|error| ApiError::from(anyhow::anyhow!(error.to_string())))?;
        state
            .better_auth
            .delete_credential_user(user.id)
            .await
            .map_err(ApiError::from)?;
    }
    delete_legacy_account_data(&state, user.id)
        .await
        .map_err(ApiError::from)?;
    let cookie = match state
        .better_auth
        .sessions
        .revoke(&headers, secure_cookie)
        .await
    {
        Ok(cookie) => cookie,
        Err(error) if better_auth_schema_not_ready(&error.to_string()) => {
            state.better_auth.removal_cookie(secure_cookie)
        }
        Err(error) => return Err(ApiError::from(anyhow::anyhow!(error.to_string()))),
    };
    better_auth_cookie_response(StatusCode::OK, json!({ "ok": true }), &cookie)
}

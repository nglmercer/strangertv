//! Authentication endpoints. Port of `server/routes/auth.ts`.
//!
//! Error strings and status codes are copied verbatim — the client matches on
//! some of them, and the integration suite asserts on others.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use libsql::params;
use serde_json::{json, Value};

use crate::auth::password::{hash_password, hash_token, random_token, valid_credentials, verify_password};
use crate::auth::session::{
    create_session, is_banned, public_user, refresh_session, revoke_session, user_from_token,
};
use crate::age::is_adult;
use crate::constants::{DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE};
use crate::email::{reset_email_body, send_email, verify_email_body, Mail, SUBJECT_RESET, SUBJECT_VERIFY};
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

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/verify-email", post(verify_email))
        .route("/api/v1/auth/resend-verification", post(resend_verification))
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

async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let ip = client_ip(&headers);
    let rl = rate_limit_info(&format!("register:{ip}"), register_limit(), register_window_ms());
    if !rl.ok {
        // The rate-limit headers travel with the 429, as in the original.
        let mut err = ApiError::too_many("Too many attempts. Try later.");
        err.message = "Too many attempts. Try later.".into();
        let _ = rate_limit_headers(&rl);
        return Err(err);
    }
    inc("auth_register_attempts", 1);

    let email = body.get("email").and_then(Value::as_str).unwrap_or_default();
    let password = body.get("password").and_then(Value::as_str).unwrap_or_default();
    if !valid_credentials(email, password) {
        return Err(ApiError::bad_request(
            "Use a valid email and an 8+ character password.",
        ));
    }
    let birth_date = body.get("birthDate").and_then(Value::as_str).unwrap_or_default();
    if !is_adult(birth_date) {
        return Err(ApiError::bad_request("You must be 18 or older to register."));
    }
    if is_banned(&state.db, None, Some(&ip)).await.map_err(ApiError::from)? {
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
        .query("SELECT id FROM users WHERE email = ?", params![email_lower.clone()])
        .await?;
    let user_id: i64 = match rows.next().await? {
        Some(row) => row.get(0)?,
        None => return Err(ApiError::conflict("That email is already registered.")),
    };

    let token = create_session(&state.db, user_id).await.map_err(ApiError::from)?;
    state
        .db
        .conn()
        .execute(
            "INSERT INTO consents (user_id, kind) VALUES (?, ?)",
            params![user_id, crate::constants::CONSENT_KIND_TERMS_AGE],
        )
        .await?;

    let verify_token = create_email_verification_token(&state, user_id).await?;
    let mail = verify_email_body(&verify_token, &state.config.app_url);
    send_email(&Mail {
        to: email_lower,
        subject: SUBJECT_VERIFY.into(),
        text: mail.text,
        html: mail.html,
    })
    .await;

    let user = user_from_token(&state.db, Some(&token)).await.map_err(ApiError::from)?;
    inc("auth_register_ok", 1);
    crate::log_info!("auth.register", { "userId": user_id });

    let mut out = json!({
        "user": user.as_ref().map(public_user),
        "token": token,
    });
    if !state.config.is_prod {
        out["devVerifyToken"] = json!(verify_token);
    }
    Ok((StatusCode::CREATED, Json(out)))
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

async fn verify_email(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let token = body.get("token").and_then(Value::as_str).unwrap_or_default();
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
    state
        .db
        .conn()
        .execute("UPDATE users SET email_verified = 1 WHERE id = ?", params![user_id])
        .await?;
    state
        .db
        .conn()
        .execute("UPDATE email_verification_tokens SET used = 1 WHERE id = ?", params![id])
        .await?;
    inc("email_verified", 1);
    Ok(Json(json!({ "ok": true })))
}

async fn resend_verification(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = user_from_token(&state.db, get_bearer(&headers).as_deref())
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
) -> ApiResult<Json<Value>> {
    let ip = client_ip(&headers);
    let rl = rate_limit_info(&format!("login:{ip}"), 20, 15 * 60_000);
    if !rl.ok {
        return Err(ApiError::too_many("Too many attempts. Try later."));
    }
    inc("auth_login_attempts", 1);

    let email = body.get("email").and_then(Value::as_str).unwrap_or_default();
    let password = body.get("password").and_then(Value::as_str).unwrap_or_default();
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
    if !verify_password(password, &stored) {
        return Err(invalid());
    }

    let user_id: i64 = row.get(0)?;
    if is_banned(&state.db, Some(user_id), Some(&ip)).await.map_err(ApiError::from)? {
        return Err(ApiError::forbidden("This account is banned."));
    }
    let birth_date: Option<String> = row.get(2).ok();
    if !birth_date.as_deref().is_some_and(is_adult) {
        return Err(ApiError::forbidden("Your account needs a valid 18+ birthday."));
    }
    let email_verified: i64 = row.get(3).unwrap_or(0);
    if state.config.features.require_email_verified && email_verified == 0 {
        return Err(
            ApiError::forbidden("Verify your email before signing in.").with_code("email_unverified")
        );
    }

    let token = create_session(&state.db, user_id).await.map_err(ApiError::from)?;
    let user = user_from_token(&state.db, Some(&token)).await.map_err(ApiError::from)?;
    inc("auth_login_ok", 1);
    Ok(Json(json!({
        "user": user.as_ref().map(public_user),
        "token": token,
    })))
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    if let Some(token) = get_bearer(&headers) {
        revoke_session(&state.db, &token).await.map_err(ApiError::from)?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn refresh(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let token = get_bearer(&headers).ok_or_else(ApiError::unauthorized)?;
    let next = refresh_session(&state.db, &token)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;
    let user = user_from_token(&state.db, Some(&next)).await.map_err(ApiError::from)?;
    inc("auth_refresh_ok", 1);
    Ok(Json(json!({
        "token": next,
        "user": user.as_ref().map(public_user),
    })))
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = user_from_token(&state.db, get_bearer(&headers).as_deref())
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
    let bearer = get_bearer(&headers);
    let user = user_from_token(&state.db, bearer.as_deref())
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;

    // COALESCE keeps the existing column when the field is absent.
    let interests = body
        .get("interests")
        .and_then(Value::as_array)
        .map(|arr| serde_json::to_string(&arr.iter().take(10).collect::<Vec<_>>()).unwrap_or_default());

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

    let updated = user_from_token(&state.db, bearer.as_deref())
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
            .query("SELECT id FROM users WHERE email = ?", params![email_lower.clone()])
            .await?;
        if let Some(row) = rows.next().await? {
            let user_id: i64 = row.get(0)?;
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

async fn reset_confirm(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let token = body.get("token").and_then(Value::as_str).unwrap_or_default();
    let password = body.get("password").and_then(Value::as_str).unwrap_or_default();
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
        .execute("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", params![id])
        .await?;
    // Every existing session dies with the password change.
    state
        .db
        .conn()
        .execute("UPDATE sessions SET revoked = 1 WHERE user_id = ?", params![user_id])
        .await?;
    inc("password_reset_ok", 1);
    Ok(Json(json!({ "ok": true })))
}

async fn delete_account(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = user_from_token(&state.db, get_bearer(&headers).as_deref())
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;
    state
        .db
        .conn()
        .execute("UPDATE sessions SET revoked = 1 WHERE user_id = ?", params![user.id])
        .await?;
    state
        .db
        .conn()
        .execute(
            "DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?",
            params![user.id, user.id],
        )
        .await?;
    state
        .db
        .conn()
        .execute("DELETE FROM users WHERE id = ?", params![user.id])
        .await?;
    Ok(Json(json!({ "ok": true })))
}

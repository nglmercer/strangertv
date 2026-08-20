//! Blocks, reports, ratings and user search. Port of `server/routes/misc.ts`.

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use libsql::params;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::session::{public_user, user_from_token, UserRow};
use crate::error::{ApiError, ApiResult};
use crate::infra::http::{client_ip, get_bearer};
use crate::infra::metrics::inc;
use crate::infra::rate_limit::rate_limit;
use crate::AppState;

const REPORT_REASONS: &[&str] = &[
    "nudity",
    "harassment",
    "hate",
    "spam",
    "underage",
    "violence",
    "other",
];

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/blocks", post(create_block).get(list_blocks))
        .route("/api/v1/blocks/{id}", delete(remove_block))
        .route("/api/v1/reports", post(create_report))
        .route("/api/v1/ratings", post(create_rating))
        .route("/api/v1/users/search", get(search_users))
        .with_state(state)
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<UserRow> {
    user_from_token(&state.db, get_bearer(headers).as_deref())
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)
}

async fn create_block(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let blocked_id = body.get("blockedId").and_then(Value::as_i64).unwrap_or(0);
    if blocked_id == 0 || blocked_id == user.id {
        return Err(ApiError::bad_request("Invalid target"));
    }
    state
        .db
        .conn()
        .execute(
            "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
            params![user.id, blocked_id],
        )
        .await?;
    // The in-memory blocked-pair set is hydrated by matchmaking in Phase 5;
    // the row above is the durable half and is already correct.
    Ok(Json(json!({ "ok": true })))
}

async fn list_blocks(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT b.blocked_id AS id, u.email, b.created_at
             FROM blocks b
             LEFT JOIN users u ON u.id = b.blocked_id
             WHERE b.blocker_id = ?
             ORDER BY b.id DESC",
            params![user.id],
        )
        .await?;
    let mut blocked = Vec::new();
    while let Some(row) = rows.next().await? {
        blocked.push(json!({
            "id": row.get::<i64>(0).unwrap_or(0),
            "email": row.get::<String>(1).ok(),
            "createdAt": row.get::<String>(2).ok(),
        }));
    }
    Ok(Json(json!({ "blocked": blocked })))
}

async fn remove_block(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    state
        .db
        .conn()
        .execute(
            "DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?",
            params![user.id, id],
        )
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn create_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let ip = client_ip(&headers);
    if !rate_limit(&format!("report:{ip}"), 15, 60_000) {
        return Err(ApiError::too_many("Too many reports"));
    }
    // Reports are accepted from guests too, so the user lookup is optional.
    let user = user_from_token(&state.db, get_bearer(&headers).as_deref())
        .await
        .map_err(ApiError::from)?;

    let reason = body.get("reason").and_then(Value::as_str).unwrap_or_default();
    if !REPORT_REASONS.contains(&reason) {
        return Err(ApiError::bad_request("Invalid reason"));
    }
    // `detail?.slice(0, 500)` — slice counts UTF-16 units in JS; chars here.
    let detail: Option<String> = body
        .get("detail")
        .and_then(Value::as_str)
        .map(|d| d.chars().take(500).collect());

    state
        .db
        .conn()
        .execute(
            "INSERT INTO reports (reporter_id, reporter_session, room_id, reason, detail) VALUES (?, ?, ?, ?, ?)",
            params![
                user.as_ref().map(|u| u.id),
                ip,
                body.get("roomId").and_then(Value::as_str),
                reason,
                detail
            ],
        )
        .await?;
    inc("reports_total", 1);
    crate::alerts::note_report(reason).await;
    Ok(Json(json!({ "ok": true })))
}

async fn create_rating(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let ip = client_ip(&headers);
    if !rate_limit(&format!("rating:{ip}"), 40, 60_000) {
        return Err(ApiError::too_many("Too many requests"));
    }
    let user = user_from_token(&state.db, get_bearer(&headers).as_deref())
        .await
        .map_err(ApiError::from)?;

    // `Number.isInteger(score)` — a fractional score is rejected, not rounded.
    let raw = body.get("score").and_then(Value::as_f64).unwrap_or(f64::NAN);
    if !raw.is_finite() || raw.fract() != 0.0 || raw < 1.0 || raw > 5.0 {
        return Err(ApiError::bad_request("Score must be 1–5."));
    }
    let score = raw as i64;

    let room_id = body
        .get("roomId")
        .and_then(Value::as_str)
        .map(|s| s.chars().take(64).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("anon_{ip}_{}", now_ms()));

    // UNIQUE(room_id, rater_session) turns a second rating into a conflict.
    if state
        .db
        .conn()
        .execute(
            "INSERT INTO ratings (room_id, rater_id, rater_session, score) VALUES (?, ?, ?, ?)",
            params![room_id, user.as_ref().map(|u| u.id), ip, score],
        )
        .await
        .is_err()
    {
        return Err(ApiError::conflict("Already rated this match."));
    }

    inc("ratings_total", 1);
    inc(&format!("rating_score_{score}"), 1);
    Ok(Json(json!({ "ok": true })))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Deserialize)]
struct EmailQuery {
    email: Option<String>,
}

async fn search_users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<EmailQuery>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let email = q
        .email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("Email required"))?;

    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT id, email, birth_date, gender, country, language, interests, email_verified
             FROM users WHERE email = ? AND id != ?",
            params![email, user.id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(Json(json!({ "user": Value::Null })));
    };
    let found = UserRow {
        id: row.get(0)?,
        email: row.get(1)?,
        birth_date: row.get(2).ok(),
        gender: row.get(3).ok(),
        country: row.get(4).ok(),
        language: row.get(5).ok(),
        interests: row.get(6).ok(),
        email_verified: row.get(7).unwrap_or(0),
    };
    Ok(Json(json!({ "user": public_user(&found) })))
}

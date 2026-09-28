//! Points economy HTTP API: balance, leaderboard, ad claims, gifts.
//!
//! Authenticated users only. Admin adjustments live in `routes/admin.rs`
//! behind the `x-admin-key` gate.

use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::auth::resolver::resolve_authenticated_user_row;
use crate::auth::session::UserRow;
use crate::constants::ECONOMY_LEADERBOARD_MAX;
use crate::domain::economy::{self, AdOutcome, GiftOutcome};
use crate::error::{ApiError, ApiResult};
use crate::infra::metrics::inc;
use crate::infra::rate_limit::rate_limit;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/economy/me", get(me))
        .route("/api/v1/economy/leaderboard", get(leaderboard))
        .route("/api/v1/economy/ads/claim", post(claim_ad))
        .route("/api/v1/economy/gift", post(gift))
        .with_state(state)
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<UserRow> {
    resolve_authenticated_user_row(headers, state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let conn = state.db.conn();
    let balance = economy::balance(conn, user.id)
        .await
        .map_err(ApiError::from)?;
    let entries = economy::recent(conn, user.id, 20)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({
        "balance": balance,
        "recent": entries.iter().map(|e| json!({
            "delta": e.delta,
            "reason": e.reason,
            "refId": e.ref_id,
            "note": e.note,
            "createdAt": e.created_at,
        })).collect::<Vec<_>>(),
    })))
}

async fn leaderboard(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    require_user(&state, &headers).await?;
    let leaders = economy::leaderboard(state.db.conn(), ECONOMY_LEADERBOARD_MAX)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({
        "leaders": leaders.iter().map(|l| json!({
            "userId": l.user_id,
            "username": l.username,
            "displayName": l.display_name,
            "balance": l.balance,
        })).collect::<Vec<_>>(),
    })))
}

async fn claim_ad(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if !rate_limit(&format!("adclaim:{}", user.id), 10, 60_000) {
        return Err(ApiError::too_many("Too many attempts."));
    }
    match economy::claim_ad(state.db.conn(), user.id)
        .await
        .map_err(ApiError::from)?
    {
        AdOutcome::Granted {
            new_balance,
            next_claim_at,
        } => {
            inc("economy_ad_claimed", 1);
            Ok(Json(json!({
                "balance": new_balance,
                "granted": true,
                "nextClaimAt": next_claim_at,
            })))
        }
        AdOutcome::Cooldown { .. } => Err(ApiError::new(
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "Next ad reward is not ready yet.",
        )
        .with_code("ad_cooldown")),
        AdOutcome::Capped => Err(ApiError::new(
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "Daily ad limit reached.",
        )
        .with_code("ad_capped")),
    }
}

async fn gift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if !rate_limit(&format!("gift:{}", user.id), 20, 3_600_000) {
        return Err(ApiError::too_many("Too many attempts."));
    }
    let to_id = body.get("userId").and_then(Value::as_i64).unwrap_or(0);
    let amount = body.get("amount").and_then(Value::as_i64).unwrap_or(0);
    match economy::gift(state.db.conn(), user.id, to_id, amount)
        .await
        .map_err(ApiError::from)?
    {
        GiftOutcome::Sent { sender_balance } => {
            inc("economy_gift_sent", 1);
            Ok(Json(json!({ "ok": true, "balance": sender_balance })))
        }
        GiftOutcome::Insufficient { .. } => Err(
            ApiError::bad_request("Not enough points.").with_code("insufficient_funds")
        ),
        GiftOutcome::NoSuchUser => {
            Err(ApiError::new(axum::http::StatusCode::NOT_FOUND, "User not found."))
        }
        GiftOutcome::InvalidAmount => Err(ApiError::bad_request("Invalid amount.")),
        GiftOutcome::SelfGift => Err(ApiError::bad_request("You cannot gift yourself.")),
    }
}

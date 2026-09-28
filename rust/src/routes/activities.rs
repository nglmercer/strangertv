//! Activity endpoints: catalog, group-bound game instances, and the
//! user-info-only login the iframe uses.
//!
//! Two credential realms meet here and must never mix: the host app calls with
//! a full session (cookie/Bearer), while the game exchanges a launch code for
//! an instance token and then identifies with THAT token only. The
//! `/token` and `/activities/me` handlers deliberately never resolve a
//! session — a game holding a stolen session cookie still proves nothing.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::resolver::resolve_authenticated_user_row;
use crate::auth::session::{public_user, user_from_id, UserRow};
use crate::domain::activities::{
    active_instances_for_group, end_instance, exchange_code, get_activity, get_instance,
    instance_participants, instance_token_identity, join_instance, launch_instance,
    leave_instance, list_activities, ActivityError,
};
use crate::domain::groups;
use crate::error::{ApiError, ApiResult};
use crate::infra::http::get_bearer;
use crate::infra::rate_limit::rate_limit;
use crate::proto::ServerMessage;
use crate::ws::handlers::broadcast_activity_roster;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/activities", get(list))
        .route("/api/v1/activities/me", get(game_me))
        .route("/api/v1/activities/{id}/launch", post(launch))
        .route("/api/v1/activities/instances", get(list_instances))
        .route("/api/v1/activities/instances/{id}", get(show_instance))
        .route("/api/v1/activities/instances/{id}/join", post(join))
        .route("/api/v1/activities/instances/{id}/token", post(token))
        .route("/api/v1/activities/instances/{id}/leave", post(leave))
        .route("/api/v1/activities/instances/{id}/end", post(end))
        .with_state(state)
}

impl From<ActivityError> for ApiError {
    fn from(e: ActivityError) -> Self {
        match e {
            // Same shape as the group routes: every domain refusal is a 400
            // carrying the message (launch codes stay generic inside).
            ActivityError::NotFound(m) | ActivityError::Forbidden(m) | ActivityError::Invalid(m) => {
                ApiError::bad_request(m)
            }
            ActivityError::Db(err) => err.into(),
        }
    }
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<UserRow> {
    resolve_authenticated_user_row(headers, state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    require_user(&state, &headers).await?;
    Ok(Json(json!({ "activities": list_activities(&state.db).await? })))
}

async fn launch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(activity_id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    if activity_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    if !rate_limit(&format!("actlaunch:{}", user.id), 10, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let group_id = body.get("groupId").and_then(Value::as_i64).unwrap_or(0);
    if group_id == 0 {
        return Err(ApiError::bad_request("groupId is required"));
    }
    let instance = launch_instance(&state.db, activity_id, group_id, user.id).await?;
    let Some(activity) = get_activity(&state.db, instance.activity_id).await? else {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal error",
        ));
    };
    let message = ServerMessage::ActivityLaunched {
        instance: instance.clone(),
        activity,
    };
    for member in groups::get_group_members(&state.db, group_id).await.map_err(
        |e| match e {
            groups::GroupError::Db(err) => ApiError::from(err),
            groups::GroupError::NotFound(m)
            | groups::GroupError::Forbidden(m)
            | groups::GroupError::Invalid(m) => ApiError::bad_request(m),
        },
    )? {
        state.hub.send_to_user(member.user_id, &message);
    }
    Ok((StatusCode::CREATED, Json(json!({ "instance": instance }))))
}

#[derive(Deserialize)]
struct InstanceQuery {
    #[serde(rename = "groupId")]
    group_id: Option<i64>,
}

async fn list_instances(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<InstanceQuery>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let group_id = q.group_id.unwrap_or(0);
    if group_id == 0 {
        return Err(ApiError::bad_request("groupId is required"));
    }
    let instances = active_instances_for_group(&state.db, group_id, user.id).await?;
    Ok(Json(json!({ "instances": instances })))
}

async fn show_instance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(instance_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if instance_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let Some(instance) = get_instance(&state.db, instance_id).await? else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Game not found"));
    };
    // Membership, not participation: any group member may open the launcher.
    let member = groups::get_group(&state.db, instance.group_id, user.id)
        .await
        .map_err(|e| match e {
            groups::GroupError::Db(err) => ApiError::from(err),
            groups::GroupError::NotFound(m)
            | groups::GroupError::Forbidden(m)
            | groups::GroupError::Invalid(m) => ApiError::bad_request(m),
        })?
        .is_some();
    if !member {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Game not found"));
    }
    let activity = get_activity(&state.db, instance.activity_id).await?;
    let participants = instance_participants(&state.db, instance_id).await?;
    Ok(Json(json!({
        "instance": instance,
        "activity": activity,
        "participants": participants,
    })))
}

async fn join(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(instance_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if instance_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    if !rate_limit(&format!("actjoin:{}", user.id), 20, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let code = join_instance(&state.db, instance_id, user.id).await?;
    if let Some(instance) = get_instance(&state.db, instance_id).await? {
        broadcast_activity_roster(&state, instance.group_id, instance_id, false).await;
    }
    // The plaintext code is returned exactly once, like a session token at
    // login; only its hash is stored.
    Ok(Json(json!({ "code": code })))
}

/// Launch-code → instance-token exchange. The code is the ONLY credential
/// accepted here: no session is resolved, so a hostile or compromised game
/// cannot upgrade a code into anything but its own scoped token.
async fn token(
    State(state): State<AppState>,
    Path(instance_id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    if instance_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    if !rate_limit(&format!("acttoken:{instance_id}"), 20, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let code = body.get("code").and_then(Value::as_str).unwrap_or_default();
    if code.is_empty() {
        return Err(ApiError::bad_request("code is required"));
    }
    let (token, user_id) = exchange_code(&state.db, instance_id, code).await?;
    Ok(Json(json!({ "token": token, "instanceId": instance_id, "userId": user_id })))
}

/// Scoped identity for the game: id plus display names, nothing else. No
/// email, no birth date, no preferences — and session credentials are NOT
/// consulted, so this endpoint proves instance membership and nothing more.
async fn game_me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let Some(token) = get_bearer(&headers) else {
        return Err(ApiError::unauthorized());
    };
    let Some(identity) = instance_token_identity(&state.db, &token).await? else {
        return Err(ApiError::unauthorized());
    };
    let row = user_from_id(&state.db, identity.user_id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;
    let user = public_user(&row);
    Ok(Json(json!({
        "instanceId": identity.instance_id,
        "user": {
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
        },
    })))
}

async fn leave(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(instance_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if instance_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let instance = get_instance(&state.db, instance_id)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Game not found"))?;
    let ended = leave_instance(&state.db, instance_id, user.id).await?;
    broadcast_activity_roster(&state, instance.group_id, instance_id, ended).await;
    Ok(Json(json!({ "ok": true, "ended": ended })))
}

async fn end(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(instance_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if instance_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let instance = get_instance(&state.db, instance_id)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Game not found"))?;
    end_instance(&state.db, instance_id, user.id).await?;
    broadcast_activity_roster(&state, instance.group_id, instance_id, true).await;
    Ok(Json(json!({ "ok": true })))
}

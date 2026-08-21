//! Friends, messages, follows and match invitations over HTTP.
//! Port of `server/routes/social.ts`.
//!
//! Each mutation also pushes a WebSocket frame to the affected user when they
//! are connected, so an open client updates without polling.

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use libsql::params;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::session::{public_user, user_from_token, UserRow};
use crate::domain::friends::{
    cancel_invitation, follow_user, get_follows, get_friends, get_invitations, remove_friend,
    respond_friend_request, respond_invitation, send_friend_request, send_invitation, unfollow_user,
    FriendError,
};
use crate::domain::messages::{get_conversation, has_relationship, send_message, SendError};
use crate::error::{ApiError, ApiResult};
use crate::infra::http::get_bearer;
use crate::infra::rate_limit::rate_limit;
use crate::proto::{FollowEntry, InvitationEntry, InvitationStatus, ServerMessage};
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/friends", get(list_friends))
        .route("/api/v1/friends/request", post(request_friend))
        .route("/api/v1/friends/{id}/accept", patch(accept_friend))
        .route("/api/v1/friends/{id}/decline", patch(decline_friend))
        .route("/api/v1/friends/{id}", delete(delete_friend))
        .route("/api/v1/messages", get(list_messages).post(post_message))
        .route("/api/v1/follows", get(list_follows).post(create_follow))
        .route("/api/v1/follows/{id}", delete(delete_follow))
        .route("/api/v1/invitations", get(list_invitations).post(create_invitation))
        .route("/api/v1/invitations/{id}/accept", patch(accept_invitation))
        .route("/api/v1/invitations/{id}/decline", patch(decline_invitation))
        .route("/api/v1/invitations/{id}", delete(delete_invitation))
        .with_state(state)
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<UserRow> {
    user_from_token(&state.db, get_bearer(headers).as_deref())
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)
}

impl From<FriendError> for ApiError {
    fn from(e: FriendError) -> Self {
        match e {
            FriendError::SelfTarget(m) | FriendError::NotFound(m) => ApiError::bad_request(m),
            FriendError::Db(err) => err.into(),
        }
    }
}

async fn user_exists(state: &AppState, user_id: i64) -> ApiResult<bool> {
    let mut rows = state
        .db
        .conn()
        .query("SELECT id FROM users WHERE id = ?", params![user_id])
        .await?;
    Ok(rows.next().await?.is_some())
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

async fn list_friends(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let friends: Vec<Value> = get_friends(&state.db, user.id)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(|f| {
            json!({
                "id": f.id,
                "userAId": f.user_a_id,
                "userBId": f.user_b_id,
                "status": f.status,
                "createdAt": f.created_at,
                "updatedAt": f.updated_at,
                "otherUser": f.other_user,
            })
        })
        .collect();
    Ok(Json(json!({ "friends": friends })))
}

async fn request_friend(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let target_id = body.get("userId").and_then(Value::as_i64).unwrap_or(0);
    if target_id == 0 || target_id == user.id {
        return Err(ApiError::bad_request("Invalid target"));
    }
    if !user_exists(&state, target_id).await? {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "User not found",
        ));
    }
    send_friend_request(&state.db, user.id, target_id).await?;

    state.hub.send_to_user(
        target_id,
        &ServerMessage::FriendRequest {
            friend_id: user.id,
            from: public_user(&user),
        },
    );
    Ok(Json(json!({ "ok": true })))
}

async fn accept_friend(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(friend_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if friend_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    respond_friend_request(&state.db, friend_id, user.id, true).await?;

    // Tell the requester, whichever column they sit in.
    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT user_a_id, user_b_id FROM friends WHERE id = ?",
            params![friend_id],
        )
        .await?;
    if let Some(row) = rows.next().await? {
        let a: i64 = row.get(0)?;
        let b: i64 = row.get(1)?;
        let other_id = if a == user.id { b } else { a };
        state.hub.send_to_user(
            other_id,
            &ServerMessage::FriendAccepted {
                friend_id,
                from: public_user(&user),
            },
        );
    }
    Ok(Json(json!({ "ok": true })))
}

async fn decline_friend(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(friend_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if friend_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    respond_friend_request(&state.db, friend_id, user.id, false).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn delete_friend(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(friend_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if friend_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    remove_friend(&state.db, friend_id, user.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct MessageQuery {
    #[serde(rename = "friendId")]
    friend_id: Option<i64>,
    limit: Option<i64>,
    #[serde(rename = "beforeId")]
    before_id: Option<i64>,
}

async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<MessageQuery>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let friend_id = q
        .friend_id
        .filter(|id| *id != 0)
        .ok_or_else(|| ApiError::bad_request("friendId required"))?;
    if !has_relationship(&state.db, user.id, friend_id)
        .await
        .map_err(ApiError::from)?
    {
        return Err(ApiError::forbidden("No relationship"));
    }
    // `Math.min(Number(limit) || 50, 100)`
    let limit = q.limit.filter(|l| *l != 0).unwrap_or(50).min(100);
    let messages = get_conversation(&state.db, user.id, friend_id, limit, q.before_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "messages": messages })))
}

async fn post_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if !rate_limit(&format!("msg:{}", user.id), 30, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let friend_id = body.get("friendId").and_then(Value::as_i64).unwrap_or(0);
    let text = body.get("text").and_then(Value::as_str).unwrap_or_default();
    if friend_id == 0 || text.is_empty() {
        return Err(ApiError::bad_request("friendId and text required"));
    }
    if !has_relationship(&state.db, user.id, friend_id)
        .await
        .map_err(ApiError::from)?
    {
        return Err(ApiError::forbidden("No relationship"));
    }
    let message = match send_message(&state.db, user.id, friend_id, text).await {
        Ok(m) => m,
        Err(SendError::NoRelationship) => return Err(ApiError::forbidden("No relationship")),
        Err(SendError::Db(err)) => return Err(err.into()),
    };

    state
        .hub
        .send_to_user(friend_id, &ServerMessage::MessageNew { message: message.clone() });
    Ok(Json(json!({ "message": message })))
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

async fn create_follow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let target_id = body.get("userId").and_then(Value::as_i64).unwrap_or(0);
    if target_id == 0 || target_id == user.id {
        return Err(ApiError::bad_request("Invalid target"));
    }
    if !user_exists(&state, target_id).await? {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "User not found",
        ));
    }
    follow_user(&state.db, user.id, target_id).await?;

    state.hub.send_to_user(
        target_id,
        &ServerMessage::FollowConfirm {
            followed: public_user(&user),
        },
    );
    Ok(Json(json!({ "ok": true })))
}

async fn delete_follow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(followed_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if followed_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    unfollow_user(&state.db, user.id, followed_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_follows(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let follows = get_follows(&state.db, user.id).await.map_err(ApiError::from)?;

    // Both arrays use `followedId`/`followedUser` keys, even the followers one —
    // matching the shape the client already reads.
    let map = |rows: Vec<crate::domain::friends::FollowRow>| -> Vec<Value> {
        rows.into_iter()
            .map(|r| json!({ "id": r.id, "followedId": r.user_id, "followedUser": r.user }))
            .collect()
    };
    Ok(Json(json!({
        "followers": map(follows.followers),
        "following": map(follows.following),
    })))
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

async fn list_invitations(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let invitations: Vec<Value> = get_invitations(&state.db, user.id)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(|i| {
            json!({
                "id": i.id,
                "inviterId": i.inviter_id,
                "roomId": i.room_id,
                "status": i.status,
                "createdAt": i.created_at,
                "expiresAt": i.expires_at,
                "inviterUser": i.inviter_user,
            })
        })
        .collect();
    Ok(Json(json!({ "invitations": invitations })))
}

async fn create_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let target_id = body.get("userId").and_then(Value::as_i64).unwrap_or(0);
    let room_id = body.get("roomId").and_then(Value::as_str).unwrap_or_default();
    if target_id == 0 || room_id.is_empty() {
        return Err(ApiError::bad_request("Missing userId or roomId"));
    }
    if target_id == user.id {
        return Err(ApiError::bad_request("Cannot invite yourself"));
    }
    if !user_exists(&state, target_id).await? {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "User not found",
        ));
    }
    let invitation_id = send_invitation(&state.db, user.id, target_id, room_id).await?;

    state.hub.send_to_user(
        target_id,
        &ServerMessage::InvitationSend {
            invitation_id,
            room_id: room_id.to_string(),
            inviter: public_user(&user),
        },
    );
    Ok(Json(json!({ "ok": true })))
}

async fn accept_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(invitation_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    respond_invitation_route(state, headers, invitation_id, true).await
}

async fn decline_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(invitation_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    respond_invitation_route(state, headers, invitation_id, false).await
}

async fn respond_invitation_route(
    state: AppState,
    headers: HeaderMap,
    invitation_id: i64,
    accept: bool,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if invitation_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    respond_invitation(&state.db, invitation_id, user.id, accept).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn delete_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(invitation_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if invitation_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    cancel_invitation(&state.db, invitation_id, user.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "ok": true })))
}

/// Kept so the unused-import lint does not hide a real omission; these types
/// are the ones the WS layer uses for the same lists in Phase 6.
#[allow(unused)]
fn _wire_types(_: FollowEntry, _: InvitationEntry, _: InvitationStatus) {}

//! Persistent group endpoints. Port of `server/routes/groups.ts`.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::session::{user_from_token, UserRow};
use crate::domain::groups::{
    add_group_members, create_group, get_group, get_group_invite, get_group_invites,
    get_group_members, get_group_messages, get_groups, leave_group, remove_group_member,
    rename_group, respond_group_invite, send_group_message, GroupError,
};
use crate::error::{ApiError, ApiResult};
use crate::infra::http::get_bearer;
use crate::infra::rate_limit::rate_limit;
use crate::proto::ServerMessage;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/groups", get(list_groups).post(create))
        .route("/api/v1/groups/{id}", get(show).patch(rename))
        .route("/api/v1/groups/{id}/members", get(members).post(add_members))
        .route("/api/v1/groups/{id}/members/{userId}", delete(remove_member))
        .route("/api/v1/groups/{id}/leave", post(leave))
        .route(
            "/api/v1/groups/{id}/messages",
            get(list_messages).post(post_message),
        )
        .route("/api/v1/group-invites", get(list_invites))
        .route("/api/v1/group-invites/{id}/accept", patch(accept_invite))
        .route("/api/v1/group-invites/{id}/decline", patch(decline_invite))
        .with_state(state)
}

impl From<GroupError> for ApiError {
    fn from(e: GroupError) -> Self {
        match e {
            // The route layer reports every domain refusal as a 400, matching
            // the Hono handlers' catch-and-return-message shape.
            GroupError::NotFound(m) | GroupError::Forbidden(m) | GroupError::Invalid(m) => {
                ApiError::bad_request(m)
            }
            GroupError::Db(err) => err.into(),
        }
    }
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<UserRow> {
    user_from_token(&state.db, get_bearer(headers).as_deref())
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)
}

fn group_json(g: &crate::domain::groups::Group) -> Value {
    json!({
        "id": g.id,
        "name": g.name,
        "createdBy": g.created_by,
        "createdAt": g.created_at,
        "myRole": g.my_role,
        "memberCount": g.member_count,
    })
}

fn member_json(m: &crate::domain::groups::GroupMember) -> Value {
    json!({
        "id": m.id,
        "groupId": m.group_id,
        "userId": m.user_id,
        "role": m.role,
        "joinedAt": m.joined_at,
        "user": m.user,
    })
}

async fn list_groups(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let groups: Vec<Value> = get_groups(&state.db, user.id)
        .await?
        .iter()
        .map(group_json)
        .collect();
    Ok(Json(json!({ "groups": groups })))
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let name = body.get("name").and_then(Value::as_str).unwrap_or_default();
    if name.trim().is_empty() {
        return Err(ApiError::bad_request("Group name is required"));
    }
    let member_ids: Vec<i64> = body
        .get("memberIds")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();

    let (group, _members) = create_group(&state.db, user.id, name, &member_ids).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "group": group.as_ref().map(group_json) })),
    ))
}

async fn show(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if group_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let group = get_group(&state.db, group_id, user.id)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Group not found"))?;
    Ok(Json(json!({ "group": group_json(&group) })))
}

async fn rename(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if group_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let name = body.get("name").and_then(Value::as_str).unwrap_or_default();
    if name.trim().is_empty() {
        return Err(ApiError::bad_request("Group name is required"));
    }
    rename_group(&state.db, group_id, user.id, name).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    require_user(&state, &headers).await?;
    if group_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let members: Vec<Value> = get_group_members(&state.db, group_id)
        .await?
        .iter()
        .map(member_json)
        .collect();
    Ok(Json(json!({ "members": members })))
}

async fn add_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if group_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let user_ids: Vec<i64> = body
        .get("userIds")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    if user_ids.is_empty() {
        return Err(ApiError::bad_request("userIds required"));
    }
    add_group_members(&state.db, group_id, user.id, &user_ids).await?;
    let members: Vec<Value> = get_group_members(&state.db, group_id)
        .await?
        .iter()
        .map(member_json)
        .collect();
    Ok(Json(json!({ "members": members })))
}

async fn remove_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((group_id, target_user_id)): Path<(i64, i64)>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if group_id == 0 || target_user_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    remove_group_member(&state.db, group_id, user.id, target_user_id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn leave(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if group_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let out = leave_group(&state.db, group_id, user.id).await?;
    Ok(Json(json!({ "ok": true, "left": true, "dissolved": out.dissolved })))
}

#[derive(Deserialize)]
struct MessageQuery {
    limit: Option<i64>,
    #[serde(rename = "beforeId")]
    before_id: Option<i64>,
}

async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<i64>,
    Query(q): Query<MessageQuery>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if group_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let limit = q.limit.filter(|l| *l != 0).unwrap_or(50).min(100);
    let messages = get_group_messages(&state.db, group_id, user.id, limit, q.before_id).await?;
    Ok(Json(json!({ "messages": messages })))
}

async fn post_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if group_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    if !rate_limit(&format!("groupmsg:{}", user.id), 30, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let text = body.get("text").and_then(Value::as_str).unwrap_or_default();
    if text.trim().is_empty() {
        return Err(ApiError::bad_request("text is required"));
    }
    let message = send_group_message(&state.db, group_id, user.id, text).await?;

    // Fan out to every member, sender included — the client relies on the echo
    // to confirm delivery.
    for member in get_group_members(&state.db, group_id).await? {
        state.hub.send_to_user(
            member.user_id,
            &ServerMessage::GroupMessageNew {
                message: message.clone(),
            },
        );
    }
    Ok(Json(json!({ "message": message })))
}

async fn list_invites(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    let invites: Vec<Value> = get_group_invites(&state.db, user.id)
        .await?
        .into_iter()
        .map(|i| {
            json!({
                "id": i.id,
                "groupId": i.group_id,
                "inviterId": i.inviter_id,
                "inviteeId": i.invitee_id,
                "status": i.status,
                "createdAt": i.created_at,
                "groupName": i.group_name,
                "inviterUser": i.inviter_user,
            })
        })
        .collect();
    Ok(Json(json!({ "invites": invites })))
}

async fn accept_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(invite_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    respond_invite(state, headers, invite_id, true).await
}

async fn decline_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(invite_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    respond_invite(state, headers, invite_id, false).await
}

async fn respond_invite(
    state: AppState,
    headers: HeaderMap,
    invite_id: i64,
    accept: bool,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if invite_id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    let result = respond_group_invite(&state.db, invite_id, user.id, accept).await?;

    // The invite row is re-read so a deleted group does not produce a
    // notification for something that no longer exists.
    if get_group_invite(&state.db, invite_id).await?.is_some() {
        let message = if accept {
            ServerMessage::GroupInviteAccepted {
                invite_id,
                group_id: result.group_id,
                user_id: user.id,
            }
        } else {
            ServerMessage::GroupInviteDeclined {
                invite_id,
                group_id: result.group_id,
                user_id: user.id,
            }
        };
        state.hub.send_to_user(result.inviter_id, &message);
    }
    Ok(Json(json!({ "ok": true })))
}

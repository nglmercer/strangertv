//! WebSocket protocol. Port of `server/ws/handlers.ts`.
//!
//! One function per client message type, dispatched from `handle_message`. The
//! shape mirrors the original's long if-chain, but the payloads are the typed
//! `ClientMessage` variants from the generated contract rather than casts.

use std::sync::Arc;

use libsql::params;

use crate::auth::session::{public_user, user_from_token, UserRow};
use crate::db::Db;
use crate::domain::friends as friends_svc;
use crate::domain::groups as groups_svc;
use crate::domain::messages as messages_svc;
use crate::matchmaking::{Engine, Hub, SocketId};
use crate::proto::{
    ClientMessage, GroupVisibility, MatchMode, MatchPreferences, PublicUser, ServerMessage,
};
use crate::AppState;

/// Reasons carried on `room:peer-left`, matching `PEER_LEFT_REASON`.
const REASON_NEXT: &str = "next";
const REASON_LEAVE: &str = "leave";
const REASON_USER_LEFT: &str = "user_left";
const REASON_REPORTED: &str = "reported";
const REASON_BLOCKED: &str = "blocked";
const REASON_GROUP_INVITE: &str = "group_invite";

/// Per-connection context.
pub struct WsContext {
    pub socket: SocketId,
    pub ip: String,
    pub session_key: String,
}

fn err(code: &str, message: &str) -> ServerMessage {
    ServerMessage::Error {
        code: code.into(),
        message: message.into(),
    }
}

fn send(hub: &Hub, socket: SocketId, message: &ServerMessage) {
    if let Some(handle) = hub.socket_by_id(socket) {
        hub.send(&handle, message);
    }
}

/// The caller's user id: the socket's authenticated identity, falling back to
/// the queue metadata (which a guest-then-signed-in session may carry).
async fn caller_user_id(state: &AppState, socket: SocketId) -> Option<i64> {
    if let Some(id) = state.hub.user_of(socket) {
        return Some(id);
    }
    state.engine.meta_of(socket).await.and_then(|m| m.user_id)
}

/// Full profile for embedding in a notification, falling back to a bare id when
/// the row is missing — the original never fails a notification over this.
async fn profile_of(db: &Db, user_id: i64) -> PublicUser {
    let row = load_user(db, user_id).await;
    match row {
        Some(u) => public_user(&u),
        None => PublicUser {
            id: user_id,
            email: String::new(),
            birth_date: None,
            gender: None,
            country: None,
            language: None,
            interests: None,
            email_verified: None,
        },
    }
}

async fn load_user(db: &Db, user_id: i64) -> Option<UserRow> {
    let mut rows = db
        .conn()
        .query(
            "SELECT id, email, birth_date, gender, country, language, interests, email_verified
             FROM users WHERE id = ?",
            params![user_id],
        )
        .await
        .ok()?;
    let row = rows.next().await.ok()??;
    Some(UserRow {
        id: row.get(0).ok()?,
        email: row.get(1).ok()?,
        birth_date: row.get(2).ok(),
        gender: row.get(3).ok(),
        country: row.get(4).ok(),
        language: row.get(5).ok(),
        interests: row.get(6).ok(),
        email_verified: row.get(7).unwrap_or(0),
    })
}

pub async fn handle_message(state: &AppState, ctx: &WsContext, raw: &str) {
    let Ok(message) = serde_json::from_str::<ClientMessage>(raw) else {
        // Unknown or malformed frames are ignored, as in the original.
        return;
    };
    dispatch(state, ctx, message).await;
}

async fn dispatch(state: &AppState, ctx: &WsContext, message: ClientMessage) {
    let hub = &state.hub;
    let engine: &Arc<Engine> = &state.engine;
    let socket = ctx.socket;

    match message {
        ClientMessage::QueueHeartbeat => engine.heartbeat(socket).await,

        ClientMessage::WsAuth { token } => {
            if let Some(token) = token {
                if let Ok(Some(user)) = user_from_token(&state.db, Some(&token)).await {
                    hub.register_user(socket, user.id);
                    crate::presence::announce_online(&state.db, hub, user.id, socket).await;
                }
            }
        }

        ClientMessage::QueueJoin { preferences, token } => {
            join(state, ctx, preferences, token, false).await;
        }
        ClientMessage::RoomNext { preferences, token } => {
            join(state, ctx, preferences, token, true).await;
        }

        ClientMessage::QueueLeave | ClientMessage::RoomLeave => {
            engine.remove_from_queue(socket).await;
            engine.leave_room(socket, true, Some(REASON_LEAVE)).await;
        }

        ClientMessage::GroupMatchCreate {
            visibility,
            preferences,
            token,
        } => {
            let Some(user) = require_token(state, socket, token.as_deref(), "Sign in to create group matches.").await
            else {
                return;
            };
            engine
                .create_group_match_room(
                    socket,
                    visibility,
                    preferences,
                    Some(user.id),
                    Some(user.email),
                    ctx.session_key.clone(),
                    false,
                    None,
                )
                .await;
        }

        ClientMessage::GroupMatchCreateAndInvite {
            preferences,
            user_id,
            token,
            ..
        } => {
            create_and_invite(state, ctx, preferences, user_id, token).await;
        }

        ClientMessage::GroupMatchInvite { room_id: _, user_id, token } => {
            let mut inviter_id = caller_user_id(state, socket).await;
            if inviter_id.is_none() {
                if let Some(token) = token {
                    if let Ok(Some(user)) = user_from_token(&state.db, Some(&token)).await {
                        inviter_id = Some(user.id);
                    }
                }
            }
            let Some(inviter_id) = inviter_id else {
                send(hub, socket, &err("auth_required", "Sign in to invite."));
                return;
            };
            let Some(group) = engine.group_room_of(socket).await else {
                send(hub, socket, &err("bad_prefs", "No group room."));
                return;
            };
            let targets = hub.sockets_for_user(user_id);
            if targets.is_empty() {
                send(hub, socket, &err("bad_prefs", "User is not online."));
                return;
            }
            let host = profile_of(&state.db, inviter_id).await;
            for target in targets {
                hub.send(
                    &target,
                    &ServerMessage::GroupMatchInviteReceived {
                        room_id: group.id.clone(),
                        host: host.clone(),
                    },
                );
            }
            send(hub, socket, &ServerMessage::GroupMatchInviteSent { user_id });
        }

        ClientMessage::GroupMatchJoin { room_id, token } => {
            let mut user_id = None;
            let mut email = None;
            if let Some(token) = token {
                if let Ok(Some(user)) = user_from_token(&state.db, Some(&token)).await {
                    user_id = Some(user.id);
                    email = Some(user.email);
                }
            }
            let Some(group) = engine.group_room_by_id(&room_id).await else {
                send(hub, socket, &err("bad_prefs", "Group not found."));
                return;
            };
            engine
                .leave_room(group.host_socket, true, Some(REASON_GROUP_INVITE))
                .await;
            engine.leave_room(socket, false, Some(REASON_GROUP_INVITE)).await;
            engine
                .add_participant_to_group(
                    &room_id,
                    socket,
                    group.preferences.clone(),
                    user_id,
                    email,
                    ctx.session_key.clone(),
                )
                .await;
        }

        ClientMessage::GroupMatchInviteDecline { room_id } => {
            if let Some(host) = engine.group_host_socket(&room_id).await {
                send(
                    hub,
                    host,
                    &ServerMessage::GroupMatchInviteDeclined {
                        room_id: room_id.clone(),
                    },
                );
                engine.leave_group(host, Some(REASON_USER_LEFT)).await;
            }
        }

        ClientMessage::GroupMatchStart { room_id } => {
            if engine.group_room_by_id(&room_id).await.is_none() {
                send(hub, socket, &err("bad_prefs", "Group not found."));
                return;
            }
            if !engine.is_group_participant(&room_id, socket).await {
                send(hub, socket, &err("auth_required", "Not a group participant."));
                return;
            }
            engine.start_group_match(&room_id).await;
        }

        ClientMessage::GroupMatchLeave => {
            engine.remove_from_queue(socket).await;
            engine.leave_group(socket, Some(REASON_USER_LEFT)).await;
        }

        ClientMessage::Signal {
            payload,
            target_user_id,
            target_peer_id,
        } => {
            engine
                .relay_signal(socket, payload, target_user_id, target_peer_id)
                .await;
        }

        ClientMessage::Chat { payload } => {
            if !crate::infra::rate_limit::rate_limit(&format!("wschat:{}", ctx.ip), 30, 60_000) {
                send(hub, socket, &err("rate_limit", "Slow down chat."));
                return;
            }
            let text: String = payload.text.chars().take(500).collect();
            if text.is_empty() {
                return;
            }
            let time = if payload.time.is_empty() {
                iso_now()
            } else {
                payload.time.clone()
            };

            let partner_user_id = engine.relay_chat(socket, &text, &time).await;
            // A 1:1 chat between two people who already know each other is also
            // persisted, so it shows up in their message history.
            if let (Some(me), Some(partner)) = (caller_user_id(state, socket).await, partner_user_id) {
                if messages_svc::has_relationship(&state.db, me, partner)
                    .await
                    .unwrap_or(false)
                {
                    let _ = messages_svc::send_message(&state.db, me, partner, &text).await;
                }
            }
        }

        ClientMessage::Report { reason, detail, user_id } => {
            report(state, ctx, reason, detail, user_id).await;
        }

        ClientMessage::Block { user_id } => {
            block(state, ctx, user_id).await;
        }

        ClientMessage::FriendRequest { user_id } => {
            let Some(me) = caller_user_id(state, socket).await else {
                send(hub, socket, &err("auth_required", "Sign in to send friend requests."));
                return;
            };
            if hub.sockets_for_user(user_id).is_empty() {
                send(hub, socket, &err("bad_prefs", "User is not online."));
                return;
            }
            if friends_svc::send_friend_request(&state.db, me, user_id).await.is_err() {
                return;
            }
            let from = profile_of(&state.db, me).await;
            hub.send_to_user(
                user_id,
                &ServerMessage::FriendRequest { friend_id: me, from },
            );
        }

        ClientMessage::FriendAccept { friend_id } => {
            let Some(me) = caller_user_id(state, socket).await else {
                return;
            };
            if friends_svc::respond_friend_request(&state.db, friend_id, me, true)
                .await
                .is_err()
            {
                return;
            }
            if let Some(other_id) = friend_counterpart(&state.db, friend_id, me).await {
                let from = profile_of(&state.db, other_id).await;
                hub.send_to_user(
                    other_id,
                    &ServerMessage::FriendAccepted { friend_id, from },
                );
            }
        }

        ClientMessage::FriendDecline { friend_id } => {
            if let Some(me) = caller_user_id(state, socket).await {
                let _ = friends_svc::respond_friend_request(&state.db, friend_id, me, false).await;
            }
        }

        ClientMessage::FriendRemove { friend_id } => {
            if let Some(me) = caller_user_id(state, socket).await {
                let _ = friends_svc::remove_friend(&state.db, friend_id, me).await;
            }
        }

        ClientMessage::Follow { user_id } => {
            let Some(me) = caller_user_id(state, socket).await else {
                send(hub, socket, &err("auth_required", "Sign in to follow."));
                return;
            };
            if friends_svc::follow_user(&state.db, me, user_id).await.is_err() {
                return;
            }
            let followed = profile_of(&state.db, me).await;
            hub.send_to_user(user_id, &ServerMessage::FollowConfirm { followed });
        }

        ClientMessage::Unfollow { user_id } => {
            if let Some(me) = caller_user_id(state, socket).await {
                let _ = friends_svc::unfollow_user(&state.db, me, user_id).await;
            }
        }

        ClientMessage::InvitationSend { user_id, room_id } => {
            let Some(me) = caller_user_id(state, socket).await else {
                send(hub, socket, &err("auth_required", "Sign in to send invitations."));
                return;
            };
            let Ok(invitation_id) = friends_svc::send_invitation(&state.db, me, user_id, &room_id).await
            else {
                return;
            };
            let inviter = profile_of(&state.db, me).await;
            hub.send_to_user(
                user_id,
                &ServerMessage::InvitationSend {
                    invitation_id,
                    room_id,
                    inviter,
                },
            );
        }

        ClientMessage::InvitationAccept { invitation_id, .. } => {
            let Some(me) = caller_user_id(state, socket).await else {
                return;
            };
            // Read the row BEFORE responding: the inviter and room id are needed
            // to build the match, and the update may settle the row.
            let Some((inviter_id, room_id)) = invitation_row(&state.db, invitation_id).await else {
                return;
            };
            if friends_svc::respond_invitation(&state.db, invitation_id, me, true)
                .await
                .is_err()
            {
                return;
            }
            engine.match_users(inviter_id, me).await;
            hub.send_to_user(
                inviter_id,
                &ServerMessage::InvitationAccepted {
                    invitation_id,
                    room_id,
                },
            );
        }

        ClientMessage::InvitationDecline { invitation_id } => {
            let Some(me) = caller_user_id(state, socket).await else {
                return;
            };
            let inviter_id = invitation_row(&state.db, invitation_id).await.map(|(id, _)| id);
            if friends_svc::respond_invitation(&state.db, invitation_id, me, false)
                .await
                .is_err()
            {
                return;
            }
            if let Some(inviter_id) = inviter_id {
                hub.send_to_user(
                    inviter_id,
                    &ServerMessage::InvitationDeclined { invitation_id },
                );
            }
        }

        ClientMessage::MessageSend { friend_id, text } => {
            let Some(me) = caller_user_id(state, socket).await else {
                send(hub, socket, &err("auth_required", "Sign in to send messages."));
                return;
            };
            if !crate::infra::rate_limit::rate_limit(&format!("wsmsg:{me}"), 30, 60_000) {
                send(hub, socket, &err("rate_limit", "Slow down messages."));
                return;
            }
            let text: String = text.chars().take(500).collect();
            if friend_id == 0 || text.is_empty() {
                return;
            }
            if !messages_svc::has_relationship(&state.db, me, friend_id)
                .await
                .unwrap_or(false)
            {
                send(hub, socket, &err("auth_required", "No relationship."));
                return;
            }
            let Ok(msg) = messages_svc::send_message(&state.db, me, friend_id, &text).await else {
                return;
            };
            // Self-messages are not echoed back as a new message.
            if friend_id != me {
                hub.send_to_user(friend_id, &ServerMessage::MessageNew { message: msg });
            }
        }

        ClientMessage::MessageHistory {
            friend_id,
            limit,
            before_id,
        } => {
            let Some(me) = caller_user_id(state, socket).await else {
                return;
            };
            if friend_id == 0
                || !messages_svc::has_relationship(&state.db, me, friend_id)
                    .await
                    .unwrap_or(false)
            {
                return;
            }
            let limit = limit.filter(|l| *l != 0).unwrap_or(50).min(100);
            let Ok(messages) =
                messages_svc::get_conversation(&state.db, me, friend_id, limit, before_id).await
            else {
                return;
            };
            send(
                hub,
                socket,
                &ServerMessage::MessageHistory { friend_id, messages },
            );
        }

        ClientMessage::GroupMessageSend { group_id, text } => {
            let Some(me) = caller_user_id(state, socket).await else {
                return;
            };
            if group_id == 0 || text.trim().is_empty() {
                return;
            }
            let Ok(message) = groups_svc::send_group_message(&state.db, group_id, me, &text).await
            else {
                return;
            };
            let Ok(members) = groups_svc::get_group_members(&state.db, group_id).await else {
                return;
            };
            for member in members {
                hub.send_to_user(
                    member.user_id,
                    &ServerMessage::GroupMessageNew {
                        message: message.clone(),
                    },
                );
            }
        }

        ClientMessage::GroupInviteSend { group_id, user_id } => {
            let Some(me) = caller_user_id(state, socket).await else {
                send(hub, socket, &err("auth_required", "Sign in to invite."));
                return;
            };
            if !crate::infra::rate_limit::rate_limit(&format!("wsginvite:{me}"), 10, 60_000) {
                send(hub, socket, &err("rate_limit", "Slow down invites."));
                return;
            }
            match groups_svc::send_group_invite(&state.db, group_id, me, user_id).await {
                Ok(invite) => {
                    let inviter = profile_of(&state.db, me).await;
                    hub.send_to_user(
                        user_id,
                        &ServerMessage::GroupInvite {
                            invite_id: invite.id,
                            group_id: invite.group_id,
                            group_name: invite.group_name,
                            inviter,
                        },
                    );
                }
                Err(e) => {
                    let msg = match e {
                        groups_svc::GroupError::NotFound(m)
                        | groups_svc::GroupError::Forbidden(m)
                        | groups_svc::GroupError::Invalid(m) => m,
                        groups_svc::GroupError::Db(_) => "Invite failed.",
                    };
                    send(hub, socket, &err("bad_prefs", msg));
                }
            }
        }

        ClientMessage::GroupInviteAccept { invite_id } => {
            group_invite_response(state, socket, invite_id, true).await;
        }
        ClientMessage::GroupInviteDecline { invite_id } => {
            group_invite_response(state, socket, invite_id, false).await;
        }

        ClientMessage::TelemetryQuality {
            room_id,
            quality,
            ice_state,
            connection_state,
        } => {
            if !state.config.features.quality_telemetry {
                return;
            }
            if !crate::infra::rate_limit::rate_limit(&format!("telemetry:{}", ctx.ip), 60, 60_000) {
                return;
            }
            crate::infra::metrics::inc(&format!("webrtc_quality_{}", quality.as_str()), 1);
            crate::infra::logger::log(
                "debug",
                "webrtc.quality",
                serde_json::json!({
                    "roomId": room_id,
                    "quality": quality.as_str(),
                    "ice": ice_state,
                    "conn": connection_state,
                }),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Handlers that need more than a few lines
// ---------------------------------------------------------------------------

async fn require_token(
    state: &AppState,
    socket: SocketId,
    token: Option<&str>,
    missing_message: &str,
) -> Option<UserRow> {
    let hub = &state.hub;
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        send(hub, socket, &err("auth_required", missing_message));
        return None;
    };
    match user_from_token(&state.db, Some(token)).await {
        Ok(Some(user)) => Some(user),
        _ => {
            send(hub, socket, &err("auth_required", "Invalid token."));
            None
        }
    }
}

async fn join(
    state: &AppState,
    ctx: &WsContext,
    preferences: MatchPreferences,
    token: Option<String>,
    is_next: bool,
) {
    let hub = &state.hub;
    let socket = ctx.socket;

    if state.is_draining() {
        send(
            hub,
            socket,
            &ServerMessage::ServerDraining {
                message: Some("Server is restarting. Try again shortly.".into()),
            },
        );
        return;
    }
    if !crate::infra::rate_limit::rate_limit(&format!("wsjoin:{}", ctx.ip), 40, 60_000) {
        send(hub, socket, &err("rate_limit", "Slow down."));
        return;
    }
    if crate::auth::session::is_banned(&state.db, None, Some(&ctx.ip))
        .await
        .unwrap_or(false)
    {
        send(hub, socket, &err("banned", "Access denied."));
        return;
    }
    if !state.config.features.anonymous_match && token.is_none() {
        send(hub, socket, &err("auth_required", "Sign in to match."));
        return;
    }
    // Group mode has its own entry point; taking it here would put a group
    // lobby into the solo queue.
    if preferences.mode == MatchMode::Group {
        send(
            hub,
            socket,
            &err("bad_prefs", "Use group-match:create to start group matching."),
        );
        return;
    }

    let mut user_id = None;
    let mut user_email = None;
    if let Some(token) = token {
        if let Ok(Some(user)) = user_from_token(&state.db, Some(&token)).await {
            if crate::auth::session::is_banned(&state.db, Some(user.id), Some(&ctx.ip))
                .await
                .unwrap_or(false)
            {
                send(hub, socket, &err("banned", "Access denied."));
                return;
            }
            if state.config.features.require_email_verified && user.email_verified == 0 {
                send(hub, socket, &err("email_unverified", "Verify your email first."));
                return;
            }
            user_id = Some(user.id);
            user_email = Some(user.email);
        }
    }

    if is_next {
        state.engine.leave_room(socket, true, Some(REASON_NEXT)).await;
        crate::infra::metrics::inc("room_next", 1);
    }
    state
        .engine
        .join_queue(socket, preferences, user_id, user_email, ctx.session_key.clone())
        .await;
}

async fn create_and_invite(
    state: &AppState,
    ctx: &WsContext,
    preferences: MatchPreferences,
    target_user_id: Option<i64>,
    token: Option<String>,
) {
    let hub = &state.hub;
    let socket = ctx.socket;
    let Some(user) = require_token(state, socket, token.as_deref(), "Sign in to create group matches.").await
    else {
        return;
    };

    // Resolve the invite target BEFORE mutating match state: creating the room
    // tears down the current one, and in a degraded group match there is no 1:1
    // partner to fall back to afterwards.
    let mut targets: Vec<SocketId> = match target_user_id {
        Some(id) => hub.sockets_for_user(id).into_iter().map(|h| h.id).collect(),
        None => Vec::new(),
    };
    if targets.is_empty() {
        targets = state.engine.group_peers_of(socket).await;
    }
    if targets.is_empty() {
        if let Some(partner) = state.engine.partner_of(socket).await {
            targets.push(partner);
        }
    }

    let mut prefs = preferences;
    prefs.mode = MatchMode::Group;

    let room_id = state
        .engine
        .create_group_match_room(
            socket,
            GroupVisibility::Private,
            prefs,
            Some(user.id),
            Some(user.email.clone()),
            ctx.session_key.clone(),
            true,
            Some(REASON_GROUP_INVITE),
        )
        .await;

    if targets.is_empty() {
        return;
    }
    let host = profile_of(&state.db, user.id).await;
    for target in targets {
        send(
            hub,
            target,
            &ServerMessage::GroupMatchInviteReceived {
                room_id: room_id.clone(),
                host: host.clone(),
            },
        );
    }

    // An unanswered invite expires, releasing the host back to idle instead of
    // leaving them alone in a private room.
    let engine = Arc::clone(&state.engine);
    let hub = Arc::clone(&state.hub);
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if engine.group_participant_count(&room_id).await < 2 {
            if let Some(handle) = hub.socket_by_id(socket) {
                hub.send(
                    &handle,
                    &ServerMessage::GroupMatchInviteDeclined {
                        room_id: room_id.clone(),
                    },
                );
            }
            engine.leave_group(socket, Some(REASON_USER_LEFT)).await;
        }
    });
}

async fn report(
    state: &AppState,
    ctx: &WsContext,
    reason: crate::proto::ReportReason,
    detail: Option<String>,
    requested_user_id: Option<i64>,
) {
    let hub = &state.hub;
    let socket = ctx.socket;

    if !crate::infra::rate_limit::rate_limit(&format!("wsreport:{}", ctx.ip), 10, 60_000) {
        return;
    }
    let me = caller_user_id(state, socket).await;
    if !state.config.features.guest_reports && me.is_none() {
        send(hub, socket, &err("auth_required", "Sign in to report."));
        return;
    }

    let room_id = match state.engine.room_id_of(socket).await {
        Some(id) => Some(id),
        None => state.engine.group_room_of(socket).await.map(|g| g.id),
    };
    let target = state.engine.resolve_target_user(socket, requested_user_id).await;
    let detail: Option<String> = detail.map(|d| d.chars().take(500).collect());

    let _ = state
        .db
        .conn()
        .execute(
            "INSERT INTO reports (reporter_id, reporter_session, room_id, reason, detail, reported_id)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![me, ctx.session_key.clone(), room_id, reason.as_str(), detail, target],
        )
        .await;
    crate::infra::metrics::inc("reports_total", 1);
    crate::alerts::note_report(reason.as_str()).await;

    let partner = state.engine.partner_of(socket).await;
    let in_group = state.engine.group_room_of(socket).await.is_some();
    state.engine.leave_room(socket, true, Some(REASON_REPORTED)).await;
    if in_group {
        state.engine.leave_group(socket, Some(REASON_REPORTED)).await;
    }
    send(hub, socket, &ServerMessage::ReportAck);
    if let Some(partner) = partner {
        state.engine.leave_room(partner, false, None).await;
    }
}

async fn block(state: &AppState, ctx: &WsContext, requested_user_id: Option<i64>) {
    let hub = &state.hub;
    let socket = ctx.socket;

    let me = caller_user_id(state, socket).await;
    let peer_id = state.engine.resolve_target_user(socket, requested_user_id).await;
    if let (Some(me), Some(peer_id)) = (me, peer_id) {
        let _ = state
            .db
            .conn()
            .execute(
                "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
                params![me, peer_id],
            )
            .await;
        state.engine.block_pair(me, peer_id).await;
        crate::infra::metrics::inc("blocks_total", 1);
    }

    let partner = state.engine.partner_of(socket).await;
    // Blocking from a group match takes the blocker out of the room; the
    // remaining participants keep talking to each other.
    if state.engine.group_room_of(socket).await.is_some() {
        state.engine.leave_group(socket, Some(REASON_BLOCKED)).await;
    }
    state.engine.leave_room(socket, true, Some(REASON_BLOCKED)).await;
    send(hub, socket, &ServerMessage::BlockAck);
    if let Some(partner) = partner {
        state.engine.leave_room(partner, false, None).await;
    }
}

async fn group_invite_response(state: &AppState, socket: SocketId, invite_id: i64, accept: bool) {
    let Some(me) = caller_user_id(state, socket).await else {
        return;
    };
    let Ok(result) = groups_svc::respond_group_invite(&state.db, invite_id, me, accept).await else {
        return;
    };
    let message = if accept {
        ServerMessage::GroupInviteAccepted {
            invite_id,
            group_id: result.group_id,
            user_id: me,
        }
    } else {
        ServerMessage::GroupInviteDeclined {
            invite_id,
            group_id: result.group_id,
            user_id: me,
        }
    };
    state.hub.send_to_user(result.inviter_id, &message);
}

async fn friend_counterpart(db: &Db, friend_id: i64, me: i64) -> Option<i64> {
    let mut rows = db
        .conn()
        .query(
            "SELECT user_a_id, user_b_id FROM friends WHERE id = ?",
            params![friend_id],
        )
        .await
        .ok()?;
    let row = rows.next().await.ok()??;
    let a: i64 = row.get(0).ok()?;
    let b: i64 = row.get(1).ok()?;
    Some(if a == me { b } else { a })
}

async fn invitation_row(db: &Db, invitation_id: i64) -> Option<(i64, String)> {
    let mut rows = db
        .conn()
        .query(
            "SELECT inviter_id, room_id FROM invitations WHERE id = ?",
            params![invitation_id],
        )
        .await
        .ok()?;
    let row = rows.next().await.ok()??;
    Some((row.get(0).ok()?, row.get(1).ok()?))
}

fn iso_now() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

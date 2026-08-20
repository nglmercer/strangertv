//! Messages the browser sends over the WebSocket.
//!
//! Port of `ClientMessage` in `shared/types.ts`. The TS union discriminates on
//! `type`, which maps exactly onto `#[serde(tag = "type")]`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::common::*;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
// `rename_all` on an enum renames the VARIANTS; the variant names here are
// set explicitly per arm, so field casing needs `rename_all_fields`.
#[serde(tag = "type", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum ClientMessage {
    #[serde(rename = "ws:auth")]
    WsAuth {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        token: Option<String>,
    },

    #[serde(rename = "queue:join")]
    QueueJoin {
        preferences: MatchPreferences,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        token: Option<String>,
    },

    #[serde(rename = "queue:leave")]
    QueueLeave,

    #[serde(rename = "queue:heartbeat")]
    QueueHeartbeat,

    #[serde(rename = "room:next")]
    RoomNext {
        preferences: MatchPreferences,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        token: Option<String>,
    },

    #[serde(rename = "room:leave")]
    RoomLeave,

    #[serde(rename = "signal")]
    Signal {
        payload: SignalPayload,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        target_user_id: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        target_peer_id: Option<i64>,
    },

    #[serde(rename = "chat")]
    Chat {
        payload: ChatPayload,
    },

    /// `user_id` names the reported participant; required to target one person
    /// in a group match.
    #[serde(rename = "report")]
    Report {
        reason: ReportReason,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        detail: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        user_id: Option<i64>,
    },

    #[serde(rename = "block")]
    Block {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        user_id: Option<i64>,
    },

    #[serde(rename = "friend:request")]
    FriendRequest {
        #[ts(type = "number")]
        user_id: i64,
    },
    #[serde(rename = "friend:accept")]
    FriendAccept {
        #[ts(type = "number")]
        friend_id: i64,
    },
    #[serde(rename = "friend:decline")]
    FriendDecline {
        #[ts(type = "number")]
        friend_id: i64,
    },
    #[serde(rename = "friend:remove")]
    FriendRemove {
        #[ts(type = "number")]
        friend_id: i64,
    },

    #[serde(rename = "follow")]
    Follow {
        #[ts(type = "number")]
        user_id: i64,
    },
    #[serde(rename = "unfollow")]
    Unfollow {
        #[ts(type = "number")]
        user_id: i64,
    },

    #[serde(rename = "invitation:send")]
    InvitationSend {
        #[ts(type = "number")]
        user_id: i64,
        room_id: String,
    },
    #[serde(rename = "invitation:accept")]
    InvitationAccept {
        #[ts(type = "number")]
        invitation_id: i64,
        room_id: String,
    },
    #[serde(rename = "invitation:decline")]
    InvitationDecline {
        #[ts(type = "number")]
        invitation_id: i64,
    },

    #[serde(rename = "message:send")]
    MessageSend {
        #[ts(type = "number")]
        friend_id: i64,
        text: String,
    },
    #[serde(rename = "message:history")]
    MessageHistory {
        #[ts(type = "number")]
        friend_id: i64,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        limit: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        before_id: Option<i64>,
    },

    #[serde(rename = "group:message:send")]
    GroupMessageSend {
        #[ts(type = "number")]
        group_id: i64,
        text: String,
    },
    #[serde(rename = "group:invite:send")]
    GroupInviteSend {
        #[ts(type = "number")]
        group_id: i64,
        #[ts(type = "number")]
        user_id: i64,
    },
    #[serde(rename = "group:invite:accept")]
    GroupInviteAccept {
        #[ts(type = "number")]
        invite_id: i64,
    },
    #[serde(rename = "group:invite:decline")]
    GroupInviteDecline {
        #[ts(type = "number")]
        invite_id: i64,
    },

    #[serde(rename = "group-match:create")]
    GroupMatchCreate {
        visibility: GroupVisibility,
        preferences: MatchPreferences,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        token: Option<String>,
    },
    #[serde(rename = "group-match:create-and-invite")]
    GroupMatchCreateAndInvite {
        visibility: GroupVisibility,
        preferences: MatchPreferences,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        user_id: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        token: Option<String>,
    },
    #[serde(rename = "group-match:invite")]
    GroupMatchInvite {
        room_id: String,
        #[ts(type = "number")]
        user_id: i64,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        token: Option<String>,
    },
    #[serde(rename = "group-match:join")]
    GroupMatchJoin {
        room_id: String,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        token: Option<String>,
    },
    #[serde(rename = "group-match:invite-decline")]
    GroupMatchInviteDecline {
        room_id: String,
    },
    #[serde(rename = "group-match:leave")]
    GroupMatchLeave,
    #[serde(rename = "group-match:start")]
    GroupMatchStart {
        room_id: String,
    },

    #[serde(rename = "telemetry:quality")]
    TelemetryQuality {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        room_id: Option<String>,
        quality: Quality,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        ice_state: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        connection_state: Option<String>,
    },
}

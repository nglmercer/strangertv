//! Messages the server pushes over the WebSocket.
//!
//! Port of `ServerMessage` in `shared/types.ts`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::common::*;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
// `rename_all` on an enum renames the VARIANTS; the variant names here are
// set explicitly per arm, so field casing needs `rename_all_fields`.
#[serde(tag = "type", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum ServerMessage {
    #[serde(rename = "queue:waiting")]
    QueueWaiting {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        position: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        online: Option<i64>,
    },

    #[serde(rename = "room:matched")]
    RoomMatched {
        room_id: String,
        role: Role,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        peer_country: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        peer_email: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        peer_user_id: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        shared_interests: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        relationship: Option<RelationshipStatus>,
    },

    #[serde(rename = "room:peer-left")]
    RoomPeerLeft {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        reason: Option<String>,
    },

    #[serde(rename = "signal")]
    Signal {
        payload: SignalPayload,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        target_user_id: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        from_peer_id: Option<i64>,
    },

    #[serde(rename = "chat")]
    Chat {
        payload: ChatPayload,
    },

    #[serde(rename = "stats")]
    Stats {
        #[ts(type = "number")]
        online: i64,
        #[ts(type = "number")]
        waiting: i64,
    },

    #[serde(rename = "error")]
    Error {
        code: String,
        message: String,
    },

    #[serde(rename = "report:ack")]
    ReportAck,
    #[serde(rename = "block:ack")]
    BlockAck,

    #[serde(rename = "server:draining")]
    ServerDraining {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        message: Option<String>,
    },

    #[serde(rename = "friend:request")]
    FriendRequest {
        #[ts(type = "number")]
        friend_id: i64,
        from: PublicUser,
    },
    #[serde(rename = "friend:accepted")]
    FriendAccepted {
        #[ts(type = "number")]
        friend_id: i64,
        from: PublicUser,
    },
    #[serde(rename = "friend:declined")]
    FriendDeclined {
        #[ts(type = "number")]
        friend_id: i64,
    },
    #[serde(rename = "friend:removed")]
    FriendRemoved {
        #[ts(type = "number")]
        friend_id: i64,
    },
    #[serde(rename = "friend:list")]
    FriendList {
        friends: Vec<FriendEntry>,
    },

    /// Which of my friends are connected right now, and live changes to that.
    #[serde(rename = "presence:list")]
    PresenceList {
        #[ts(type = "number[]")]
        user_ids: Vec<i64>,
    },
    #[serde(rename = "presence:online")]
    PresenceOnline {
        #[ts(type = "number")]
        user_id: i64,
    },
    #[serde(rename = "presence:offline")]
    PresenceOffline {
        #[ts(type = "number")]
        user_id: i64,
    },

    #[serde(rename = "follow:confirm")]
    FollowConfirm {
        followed: PublicUser,
    },
    #[serde(rename = "follow:removed")]
    FollowRemoved {
        #[ts(type = "number")]
        followed_id: i64,
    },
    #[serde(rename = "follow:list")]
    FollowList {
        followers: Vec<FollowEntry>,
        following: Vec<FollowEntry>,
    },

    #[serde(rename = "invitation:send")]
    InvitationSend {
        #[ts(type = "number")]
        invitation_id: i64,
        room_id: String,
        inviter: PublicUser,
    },
    #[serde(rename = "invitation:accepted")]
    InvitationAccepted {
        #[ts(type = "number")]
        invitation_id: i64,
        room_id: String,
    },
    #[serde(rename = "invitation:declined")]
    InvitationDeclined {
        #[ts(type = "number")]
        invitation_id: i64,
    },
    #[serde(rename = "invitation:list")]
    InvitationList {
        invitations: Vec<InvitationEntry>,
    },

    #[serde(rename = "message:new")]
    MessageNew {
        message: Message,
    },
    #[serde(rename = "message:history")]
    MessageHistory {
        #[ts(type = "number")]
        friend_id: i64,
        messages: Vec<Message>,
    },

    #[serde(rename = "group:message:new")]
    GroupMessageNew {
        message: GroupMessage,
    },

    #[serde(rename = "group:invite")]
    GroupInvite {
        #[ts(type = "number")]
        invite_id: i64,
        #[ts(type = "number")]
        group_id: i64,
        group_name: String,
        inviter: PublicUser,
    },
    #[serde(rename = "group:invite:accepted")]
    GroupInviteAccepted {
        #[ts(type = "number")]
        invite_id: i64,
        #[ts(type = "number")]
        group_id: i64,
        #[ts(type = "number")]
        user_id: i64,
    },
    #[serde(rename = "group:invite:declined")]
    GroupInviteDeclined {
        #[ts(type = "number")]
        invite_id: i64,
        #[ts(type = "number")]
        group_id: i64,
        #[ts(type = "number")]
        user_id: i64,
    },

    #[serde(rename = "group-match:created")]
    GroupMatchCreated {
        room_id: String,
        visibility: GroupVisibility,
    },
    #[serde(rename = "group-match:participant-joined")]
    GroupMatchParticipantJoined {
        room_id: String,
        #[ts(type = "number")]
        user_id: i64,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional)]
        email: Option<String>,
    },
    #[serde(rename = "group-match:participant-left")]
    GroupMatchParticipantLeft {
        room_id: String,
        #[ts(type = "number")]
        user_id: i64,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[ts(optional, type = "number")]
        peer_id: Option<i64>,
    },
    #[serde(rename = "group-match:invite-received")]
    GroupMatchInviteReceived {
        room_id: String,
        host: PublicUser,
    },
    #[serde(rename = "group-match:invite-sent")]
    GroupMatchInviteSent {
        #[ts(type = "number")]
        user_id: i64,
    },
    #[serde(rename = "group-match:invite-declined")]
    GroupMatchInviteDeclined {
        room_id: String,
    },

    #[serde(rename = "group-match:matched")]
    GroupMatchMatched {
        room_id: String,
        role: Role,
        /// The receiver's own unique participant id within this match.
        #[ts(type = "number")]
        peer_id: i64,
        peers: Vec<GroupMatchPeer>,
        shared_interests: Vec<String>,
    },
}

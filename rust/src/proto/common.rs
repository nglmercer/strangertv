//! Domain types shared between client and server.
//!
//! These are the Rust source of truth for what `shared/types.ts` used to
//! declare by hand. `ts-rs` exports them back to TypeScript (see `proto/mod.rs`)
//! so the Preact client keeps compile-time agreement with the server.
//!
//! Two conventions make the generated JSON byte-identical to what the Node
//! server produced:
//!   * `rename_all = "camelCase"` — TS payloads are camelCase, Rust is snake.
//!   * `skip_serializing_if = "Option::is_none"` — `JSON.stringify` drops
//!     `undefined` fields entirely; a bare `Option` would emit `null`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

macro_rules! str_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        #[ts(export)]
        pub enum $name {
            $(#[serde(rename = $wire)] #[ts(rename = $wire)] $variant),+
        }

        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self { $(Self::$variant => $wire),+ }
            }
        }
    };
}

str_enum!(Gender { Any => "any", Male => "male", Female => "female", Other => "other" });
str_enum!(Locale { En => "en", Es => "es", Pt => "pt" });

str_enum!(
    /// WebRTC matchmaking role assigned to each peer in a room.
    Role { Offerer => "offerer", Answerer => "answerer" }
);

str_enum!(FriendStatus { Pending => "pending", Accepted => "accepted", Declined => "declined" });
str_enum!(InvitationStatus {
    Pending => "pending", Accepted => "accepted", Declined => "declined", Expired => "expired"
});
str_enum!(RelationshipStatus {
    None => "none", Friend => "friend", Following => "following", Follower => "follower"
});
str_enum!(GroupRole { Admin => "admin", Member => "member" });
str_enum!(GroupVisibility { Public => "public", Private => "private" });
str_enum!(MatchMode { Solo => "solo", Group => "group" });
str_enum!(MatchScope { All => "all", Solo => "solo", Group => "group" });
str_enum!(Side { Local => "local", Remote => "remote" });

str_enum!(ReportReason {
    Nudity => "nudity", Harassment => "harassment", Hate => "hate", Spam => "spam",
    Underage => "underage", Violence => "violence", Other => "other"
});

str_enum!(SignalKind { Offer => "offer", Answer => "answer", Candidate => "candidate" });

str_enum!(Quality {
    Connecting => "connecting", Good => "good", Poor => "poor", Failed => "failed"
});

/// Minimal public user profile shared between client and server.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PublicUser {
    #[ts(type = "number")]
    pub id: i64,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub birth_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub gender: Option<Gender>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub interests: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub email_verified: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchPreferences {
    pub country: String,
    pub language: String,
    pub gender: Gender,
    pub looking_for: Gender,
    pub interests: Vec<String>,
    pub allow_match_with_same_users: bool,
    pub mode: MatchMode,
    pub match_scope: MatchScope,
}

/// Participant info in a group match room.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GroupMatchPeer {
    /// Unique identifier for this participant within the match, assigned by the
    /// server. Used to key WebRTC mesh peers and route signals. Unlike `user_id`,
    /// it is unique even when several guests (user_id 0) share a match.
    #[ts(type = "number")]
    pub peer_id: i64,
    #[ts(type = "number")]
    pub user_id: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub country: Option<String>,
    pub role: Role,
    /// Same pre-match group as the receiver (`Local`) or the opposing party (`Remote`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub side: Option<Side>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Message {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub sender_id: i64,
    #[ts(type = "number")]
    pub recipient_id: i64,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GroupMessage {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub group_id: i64,
    #[ts(type = "number")]
    pub sender_id: i64,
    pub text: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub sender: Option<PublicUser>,
}

/// WebRTC signalling payload. `data` is opaque SDP/ICE forwarded verbatim.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SignalPayload {
    pub kind: SignalKind,
    #[ts(type = "unknown")]
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatPayload {
    pub text: String,
    pub time: String,
}

/// One entry of `friend:list`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FriendEntry {
    #[ts(type = "number")]
    pub id: i64,
    pub user: PublicUser,
    pub status: FriendStatus,
}

/// One entry of the `follow:list` arrays.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FollowEntry {
    #[ts(type = "number")]
    pub id: i64,
    pub user: PublicUser,
}

/// One entry of `invitation:list`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InvitationEntry {
    #[ts(type = "number")]
    pub id: i64,
    pub inviter: PublicUser,
    pub room_id: String,
    pub status: InvitationStatus,
    pub expires_at: String,
}

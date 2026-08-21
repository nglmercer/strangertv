//! The client/server wire contract.
//!
//! Rust is the source of truth. `cargo test export_bindings` (ts-rs) regenerates
//! the TypeScript declarations the Preact client imports; CI fails if the
//! committed output is stale, so a Rust-side schema change that would break the
//! client shows up as a `tsc` error instead of a runtime surprise.

// The contract is defined in full ahead of the handlers that will use it, so
// variants are legitimately unconstructed until their phase lands.
#![allow(dead_code)]

pub mod client;
pub mod common;
pub mod server;

// Re-exported for the handlers that arrive in later phases.
#[allow(unused_imports)]
pub use client::ClientMessage;
#[allow(unused_imports)]
pub use common::*;
#[allow(unused_imports)]
pub use server::ServerMessage;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The wire format is `{"type": "...", ...fields}` — flat, not nested under
    /// a variant key. Getting this wrong breaks every client at once.
    #[test]
    fn client_messages_are_internally_tagged_and_camel_cased() {
        let raw = json!({
            "type": "signal",
            "payload": { "kind": "offer", "data": { "sdp": "v=0" } },
            "targetUserId": 7
        });
        let msg: ClientMessage = serde_json::from_value(raw.clone()).unwrap();
        match &msg {
            ClientMessage::Signal {
                target_user_id,
                target_peer_id,
                payload,
            } => {
                assert_eq!(*target_user_id, Some(7));
                assert_eq!(*target_peer_id, None);
                assert_eq!(payload.kind, SignalKind::Offer);
            }
            other => panic!("wrong variant: {other:?}"),
        }
        // Round-trips without inventing a `targetPeerId: null`.
        assert_eq!(serde_json::to_value(&msg).unwrap(), raw);
    }

    #[test]
    fn unit_variants_serialize_as_a_bare_type_field() {
        let out = serde_json::to_value(ClientMessage::QueueLeave).unwrap();
        assert_eq!(out, json!({ "type": "queue:leave" }));

        let out = serde_json::to_value(ServerMessage::ReportAck).unwrap();
        assert_eq!(out, json!({ "type": "report:ack" }));
    }

    /// `JSON.stringify` omits `undefined` keys. A plain `Option` would emit
    /// `null`, which the client's `?.` checks treat differently.
    #[test]
    fn absent_optionals_are_omitted_not_null() {
        let out = serde_json::to_value(ServerMessage::QueueWaiting {
            position: None,
            online: Some(3),
        })
        .unwrap();
        assert_eq!(out, json!({ "type": "queue:waiting", "online": 3 }));
    }

    #[test]
    fn server_messages_camel_case_their_fields() {
        let out = serde_json::to_value(ServerMessage::RoomMatched {
            room_id: "r1".into(),
            role: Role::Offerer,
            peer_country: Some("PE".into()),
            peer_email: None,
            peer_user_id: Some(42),
            shared_interests: Some(vec!["music".into()]),
            relationship: Some(RelationshipStatus::Friend),
        })
        .unwrap();
        assert_eq!(
            out,
            json!({
                "type": "room:matched",
                "roomId": "r1",
                "role": "offerer",
                "peerCountry": "PE",
                "peerUserId": 42,
                "sharedInterests": ["music"],
                "relationship": "friend"
            })
        );
    }

    #[test]
    fn presence_list_uses_the_user_ids_key_the_client_reads() {
        let out = serde_json::to_value(ServerMessage::PresenceList {
            user_ids: vec![1, 2],
        })
        .unwrap();
        assert_eq!(out, json!({ "type": "presence:list", "userIds": [1, 2] }));
    }
}

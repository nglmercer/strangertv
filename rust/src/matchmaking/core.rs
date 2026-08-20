//! The matchmaking algorithms. Port of `server/matchmaking/core.ts`.
//!
//! Concurrency note: the Node original is single-threaded, so every function
//! here runs to completion without another request interleaving. The whole
//! engine therefore sits behind ONE `tokio::sync::Mutex` rather than
//! fine-grained locks — pairing reads the queue, picks a partner and mutates
//! several maps, and splitting that would let two joins claim the same peer.
//! An async mutex (not `std`) because relationship lookups await the database.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::constants::{DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE};
use crate::db::Db;
use crate::domain::messages::get_relationship;
use crate::infra::metrics::{inc, observe_ms};
use crate::matchmaking::sockets::{Hub, SocketId};
use crate::matchmaking::state::*;
use crate::matchmaking::QueueStats;
use crate::proto::{
    Gender, GroupMatchPeer, GroupVisibility, MatchPreferences, MatchScope, RelationshipStatus, Role,
    ServerMessage, Side,
};

pub const PEER_LEFT_DISCONNECT: &str = "disconnect";
pub const PEER_LEFT_LEAVE: &str = "leave";
pub const PEER_LEFT_REQUEUE: &str = "requeue";
pub const PEER_LEFT_HOST_LEFT: &str = "host_left";
pub const PEER_LEFT_GROUP_INVITE: &str = "group_invite";

pub struct Engine {
    state: Mutex<EngineState>,
    hub: Arc<Hub>,
    db: Arc<Db>,
}

impl Engine {
    pub fn new(hub: Arc<Hub>, db: Arc<Db>) -> Self {
        Self {
            state: Mutex::new(EngineState::default()),
            hub,
            db,
        }
    }

    pub async fn queue_stats(&self) -> QueueStats {
        self.state.lock().await.queue_stats()
    }

    // -----------------------------------------------------------------------
    // Blocks
    // -----------------------------------------------------------------------

    pub async fn block_pair(&self, a: i64, b: i64) {
        self.state
            .lock()
            .await
            .blocked_pairs
            .insert(pair_key_users("", a, b));
    }

    pub async fn unblock_pair(&self, a: i64, b: i64) {
        self.state
            .lock()
            .await
            .blocked_pairs
            .remove(&pair_key_users("", a, b));
    }

    pub async fn blocked_pair_count(&self) -> usize {
        self.state.lock().await.blocked_pairs.len()
    }

    /// Loads every persisted block into the in-memory set at boot.
    pub async fn hydrate_blocks(&self, pairs: &[(i64, i64)]) {
        let mut st = self.state.lock().await;
        for (a, b) in pairs {
            if *a != 0 && *b != 0 {
                st.blocked_pairs.insert(pair_key_users("", *a, *b));
            }
        }
    }

    // -----------------------------------------------------------------------
    // Lookups
    // -----------------------------------------------------------------------

    pub async fn partner_of(&self, socket: SocketId) -> Option<SocketId> {
        self.state.lock().await.partners.get(&socket).copied()
    }

    pub async fn partner_user_id(&self, socket: SocketId) -> Option<i64> {
        let st = self.state.lock().await;
        let room = st.rooms_by_socket.get(&socket)?;
        if room.a == socket {
            room.b_user_id
        } else if room.b == socket {
            room.a_user_id
        } else {
            None
        }
    }

    pub async fn room_id_of(&self, socket: SocketId) -> Option<String> {
        self.state
            .lock()
            .await
            .rooms_by_socket
            .get(&socket)
            .map(|r| r.id.clone())
    }

    pub async fn meta_of(&self, socket: SocketId) -> Option<QueuePeer> {
        self.state.lock().await.peer_meta.get(&socket).cloned()
    }

    pub async fn group_room_of(&self, socket: SocketId) -> Option<GroupRoom> {
        let st = self.state.lock().await;
        let id = st.group_room_of_socket.get(&socket)?;
        st.group_rooms.get(id).cloned()
    }

    pub async fn group_room_by_id(&self, room_id: &str) -> Option<GroupRoom> {
        self.state.lock().await.group_rooms.get(room_id).cloned()
    }

    pub fn rematch_cooldown_ms(&self) -> u64 {
        recent_cooldown_ms()
    }
}

// ---------------------------------------------------------------------------
// Pure compatibility rules — no state, so they are free-standing and testable.
// ---------------------------------------------------------------------------

/// `'any'` on either side matches everything.
fn gender_ok(looking_for: Gender, peer_gender: Gender) -> bool {
    let any = DEFAULT_GENDER;
    if looking_for.as_str() == any || peer_gender.as_str() == any {
        return true;
    }
    looking_for == peer_gender
}

fn country_ok(a: &str, b: &str) -> bool {
    a == DEFAULT_COUNTRY || b == DEFAULT_COUNTRY || a == b
}

fn language_ok(a: &str, b: &str) -> bool {
    a == DEFAULT_LANGUAGE || b == DEFAULT_LANGUAGE || a == b
}

fn interest_score(a: &[String], b: &[String]) -> i64 {
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    a.iter().filter(|x| b.contains(x)).count() as i64
}

/// Preference-only half of compatibility, shared by the solo, solo↔group and
/// group↔group paths.
fn preferences_compatible(pa: &MatchPreferences, pb: &MatchPreferences) -> bool {
    country_ok(&pa.country, &pb.country)
        && language_ok(&pa.language, &pb.language)
        && gender_ok(pa.looking_for, pb.gender)
        && gender_ok(pb.looking_for, pa.gender)
}

impl EngineState {
    fn is_blocked_pair(&self, a: Option<i64>, b: Option<i64>) -> bool {
        let (Some(a), Some(b)) = (a.filter(|x| *x != 0), b.filter(|x| *x != 0)) else {
            return false;
        };
        self.blocked_pairs.contains(&pair_key_users("", a, b))
    }

    fn is_recent_pair(&self, a: &QueuePeer, b: &QueuePeer) -> bool {
        let now = now_ms();
        if let (Some(au), Some(bu)) = (a.user_id, b.user_id) {
            if self
                .recent_pairs
                .get(&pair_key_users("u", au, bu))
                .is_some_and(|exp| *exp > now)
            {
                return true;
            }
        }
        self.recent_pairs
            .get(&pair_key_sessions("s", &a.session_key, &b.session_key))
            .is_some_and(|exp| *exp > now)
    }

    fn remember_pair(&mut self, a: &QueuePeer, b: &QueuePeer) {
        let until = now_ms() + recent_cooldown_ms();
        if let (Some(au), Some(bu)) = (a.user_id, b.user_id) {
            self.recent_pairs.insert(pair_key_users("u", au, bu), until);
        }
        self.recent_pairs.insert(
            pair_key_sessions("s", &a.session_key, &b.session_key),
            until,
        );
        // Opportunistic compaction, as in the original.
        if self.recent_pairs.len() > 5000 {
            let now = now_ms();
            self.recent_pairs.retain(|_, exp| *exp > now);
        }
    }

    fn compatible(&self, a: &QueuePeer, b: &QueuePeer) -> bool {
        if a.socket == b.socket {
            return false;
        }
        if self.is_blocked_pair(a.user_id, b.user_id) {
            return false;
        }
        if !a.preferences.allow_match_with_same_users && self.is_recent_pair(a, b) {
            return false;
        }
        preferences_compatible(&a.preferences, &b.preferences)
    }
}

/// `normalizePreferences` — clamps and defaults anything the client sends.
pub fn normalize_preferences(raw: &serde_json::Value) -> Option<MatchPreferences> {
    if !raw.is_object() {
        return None;
    }
    let s = |key: &str, max: usize, default: &str| -> String {
        raw.get(key)
            .and_then(|v| v.as_str())
            .map(|v| v.chars().take(max).collect())
            .unwrap_or_else(|| default.to_string())
    };
    let gender = |key: &str| -> Gender {
        match raw.get(key).and_then(|v| v.as_str()) {
            Some("any") => Gender::Any,
            Some("male") => Gender::Male,
            Some("female") => Gender::Female,
            Some("other") => Gender::Other,
            _ => Gender::Any,
        }
    };
    Some(MatchPreferences {
        country: s("country", 8, DEFAULT_COUNTRY),
        language: s("language", 16, DEFAULT_LANGUAGE),
        gender: gender("gender"),
        looking_for: gender("lookingFor"),
        interests: raw
            .get("interests")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .take(10)
                    .collect()
            })
            .unwrap_or_default(),
        // Defaults to true when absent or not a boolean.
        allow_match_with_same_users: raw
            .get("allowMatchWithSameUsers")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        mode: match raw.get("mode").and_then(|v| v.as_str()) {
            Some("group") => crate::proto::MatchMode::Group,
            _ => crate::proto::MatchMode::Solo,
        },
        match_scope: match raw.get("matchScope").and_then(|v| v.as_str()) {
            Some("solo") => MatchScope::Solo,
            Some("group") => MatchScope::Group,
            _ => MatchScope::All,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn prefs(country: &str, language: &str, gender: Gender, looking_for: Gender) -> MatchPreferences {
        MatchPreferences {
            country: country.into(),
            language: language.into(),
            gender,
            looking_for,
            interests: vec![],
            allow_match_with_same_users: true,
            mode: crate::proto::MatchMode::Solo,
            match_scope: MatchScope::All,
        }
    }

    #[test]
    fn any_matches_everything_on_either_side() {
        assert!(gender_ok(Gender::Any, Gender::Male));
        assert!(gender_ok(Gender::Male, Gender::Any));
        assert!(gender_ok(Gender::Male, Gender::Male));
        assert!(!gender_ok(Gender::Male, Gender::Female));

        assert!(country_ok("any", "PE"));
        assert!(country_ok("PE", "any"));
        assert!(country_ok("PE", "PE"));
        assert!(!country_ok("PE", "US"));

        assert!(language_ok("any", "es"));
        assert!(!language_ok("es", "en"));
    }

    #[test]
    fn compatibility_requires_both_gender_directions() {
        let a = prefs("any", "any", Gender::Male, Gender::Female);
        let b = prefs("any", "any", Gender::Female, Gender::Female);
        // a wants female and b is female, but b wants female and a is male.
        assert!(!preferences_compatible(&a, &b));

        let b_ok = prefs("any", "any", Gender::Female, Gender::Male);
        assert!(preferences_compatible(&a, &b_ok));
    }

    #[test]
    fn interest_score_counts_the_overlap() {
        let a: Vec<String> = ["music", "tech", "art"].iter().map(|s| s.to_string()).collect();
        let b: Vec<String> = ["tech", "art", "food"].iter().map(|s| s.to_string()).collect();
        assert_eq!(interest_score(&a, &b), 2);
        assert_eq!(interest_score(&a, &[]), 0);
        assert_eq!(interest_score(&[], &b), 0);
    }

    #[test]
    fn preferences_are_clamped_and_defaulted() {
        let p = normalize_preferences(&json!({})).expect("object is enough");
        assert_eq!(p.country, "any");
        assert_eq!(p.language, "any");
        assert_eq!(p.gender, Gender::Any);
        assert!(p.allow_match_with_same_users, "absent means true");
        assert_eq!(p.match_scope, MatchScope::All);
        assert!(p.interests.is_empty());

        let p = normalize_preferences(&json!({
            "country": "TOOLONGCOUNTRY",
            "interests": ["a","b","c","d","e","f","g","h","i","j","k","l"],
            "gender": "nonsense",
            "matchScope": "group",
            "allowMatchWithSameUsers": false,
        }))
        .unwrap();
        assert_eq!(p.country.len(), 8, "country is clamped to 8 chars");
        assert_eq!(p.interests.len(), 10, "interests are capped at 10");
        assert_eq!(p.gender, Gender::Any, "an unknown gender falls back");
        assert_eq!(p.match_scope, MatchScope::Group);
        assert!(!p.allow_match_with_same_users);
    }

    #[test]
    fn non_objects_are_rejected() {
        assert!(normalize_preferences(&json!(null)).is_none());
        assert!(normalize_preferences(&json!("string")).is_none());
        assert!(normalize_preferences(&json!(42)).is_none());
    }
}

// ---------------------------------------------------------------------------
// Stateful operations
// ---------------------------------------------------------------------------

/// One participant as seen while assembling a match. `index` becomes the
/// client-visible `peerId`.
#[derive(Clone)]
struct SideParticipant {
    socket: SocketId,
    user_id: Option<i64>,
    email: Option<String>,
    preferences: MatchPreferences,
}

impl Engine {
    fn send(&self, socket: SocketId, message: &ServerMessage) {
        if let Some(handle) = self.hub.socket_by_id(socket) {
            self.hub.send(&handle, message);
        }
    }

    /// Stats go to everyone waiting or paired, as in `broadcastStats`.
    fn broadcast_stats(&self, st: &EngineState) {
        let stats = st.queue_stats();
        let msg = ServerMessage::Stats {
            online: stats.online,
            waiting: stats.waiting,
        };
        for peer in &st.waiting_peers {
            self.send(peer.socket, &msg);
        }
        for id in &st.waiting_groups {
            if let Some(group) = st.group_rooms.get(id) {
                for p in &group.participants {
                    self.send(p.socket, &msg);
                }
            }
        }
        for socket in st.partners.keys() {
            self.send(*socket, &msg);
        }
    }

    pub async fn remove_from_queue(&self, socket: SocketId) {
        let mut st = self.state.lock().await;
        Self::remove_from_queue_locked(&mut st, socket);
    }

    fn remove_from_queue_locked(st: &mut EngineState, socket: SocketId) {
        st.waiting_peers.retain(|p| p.socket != socket);
        // Only the host's own room leaves the queue, matching the original's
        // `hostSocket === socket` check.
        let hosted: Vec<String> = st
            .waiting_groups
            .iter()
            .filter(|id| {
                st.group_rooms
                    .get(*id)
                    .is_some_and(|g| g.host_socket == socket && g.in_queue)
            })
            .cloned()
            .collect();
        for id in hosted {
            st.dequeue_group(&id);
        }
    }

    /// Leaves the 1:1 room, optionally telling the partner why.
    pub async fn leave_room(&self, socket: SocketId, notify_partner: bool, reason: Option<&str>) {
        let mut st = self.state.lock().await;
        self.leave_room_locked(&mut st, socket, notify_partner, reason);
    }

    fn leave_room_locked(
        &self,
        st: &mut EngineState,
        socket: SocketId,
        notify_partner: bool,
        reason: Option<&str>,
    ) {
        let partner = st.partners.remove(&socket);
        if let Some(partner) = partner {
            st.partners.remove(&partner);
            if notify_partner {
                self.send(
                    partner,
                    &ServerMessage::RoomPeerLeft {
                        reason: reason.map(str::to_string),
                    },
                );
            }
        }
        if let Some(room) = st.rooms_by_socket.remove(&socket) {
            st.rooms_by_socket.remove(&room.a);
            st.rooms_by_socket.remove(&room.b);
        }
        st.peer_meta.remove(&socket);
    }

    /// Full teardown for a closing socket.
    pub async fn full_remove(&self, socket: SocketId) {
        let mut st = self.state.lock().await;
        Self::remove_from_queue_locked(&mut st, socket);
        self.leave_group_locked(&mut st, socket, Some(PEER_LEFT_DISCONNECT));
        self.leave_room_locked(&mut st, socket, true, Some(PEER_LEFT_DISCONNECT));
    }

    pub async fn leave_group(&self, socket: SocketId, reason: Option<&str>) -> Option<GroupRoom> {
        let mut st = self.state.lock().await;
        self.leave_group_locked(&mut st, socket, reason)
    }

    fn leave_group_locked(
        &self,
        st: &mut EngineState,
        socket: SocketId,
        reason: Option<&str>,
    ) -> Option<GroupRoom> {
        let room_id = st.group_room_of_socket.get(&socket)?.clone();
        st.group_room_of_socket.remove(&socket);

        let group = st.group_rooms.get_mut(&room_id)?;
        let participant = group.remove_participant(socket);
        let was_matched = group.matched;
        let was_host = group.host_socket == socket;

        if was_matched {
            // Live match: degrade gracefully rather than tearing the room down.
            if was_host && !group.participants.is_empty() {
                let next = group.participants[0].clone();
                group.host_socket = next.socket;
                group.host_user_id = next.user_id;
                group.host_email = next.email.clone();
            }

            let survivors: Vec<SocketId> = group.participants.iter().map(|p| p.socket).collect();
            let left_msg = ServerMessage::GroupMatchParticipantLeft {
                room_id: room_id.clone(),
                user_id: participant.as_ref().and_then(|p| p.user_id).unwrap_or(0),
                peer_id: participant.as_ref().and_then(|p| p.peer_id),
            };
            for sock in &survivors {
                self.send(*sock, &left_msg);
            }

            // One person left is not a match: release them back to idle.
            if survivors.len() <= 1 {
                let peer_left = ServerMessage::RoomPeerLeft {
                    reason: Some(reason.unwrap_or(PEER_LEFT_DISCONNECT).to_string()),
                };
                for sock in &survivors {
                    self.send(*sock, &peer_left);
                    st.group_room_of_socket.remove(sock);
                }
                let group = st.group_rooms.get_mut(&room_id)?;
                group.participants.clear();
                st.dequeue_group(&room_id);
                let removed = st.group_rooms.remove(&room_id);
                return removed;
            }
            return st.group_rooms.get(&room_id).cloned();
        }

        // Pre-match lobby: the host leaving dissolves it.
        if was_host {
            let others: Vec<SocketId> = group.participants.iter().map(|p| p.socket).collect();
            let msg = ServerMessage::RoomPeerLeft {
                reason: Some(reason.unwrap_or(PEER_LEFT_HOST_LEFT).to_string()),
            };
            for sock in &others {
                self.send(*sock, &msg);
                st.group_room_of_socket.remove(sock);
            }
            if let Some(group) = st.group_rooms.get_mut(&room_id) {
                group.participants.clear();
            }
            st.dequeue_group(&room_id);
            return st.group_rooms.remove(&room_id);
        }

        let others: Vec<SocketId> = group.participants.iter().map(|p| p.socket).collect();
        let msg = ServerMessage::GroupMatchParticipantLeft {
            room_id: room_id.clone(),
            user_id: participant.as_ref().and_then(|p| p.user_id).unwrap_or(0),
            peer_id: participant.as_ref().and_then(|p| p.peer_id),
        };
        for sock in &others {
            self.send(*sock, &msg);
        }

        if others.is_empty() {
            st.dequeue_group(&room_id);
            return st.group_rooms.remove(&room_id);
        }
        st.group_rooms.get(&room_id).cloned()
    }

    // -----------------------------------------------------------------------
    // Solo queue
    // -----------------------------------------------------------------------

    pub async fn join_queue(
        &self,
        socket: SocketId,
        preferences: MatchPreferences,
        user_id: Option<i64>,
        email: Option<String>,
        session_key: String,
    ) {
        // Everything up to the point where a partner is chosen happens under
        // one lock; the relationship lookup afterwards needs the database.
        let matched: Option<(Room, QueuePeer, QueuePeer, Vec<String>)> = {
            let mut st = self.state.lock().await;
            Self::remove_from_queue_locked(&mut st, socket);
            self.leave_room_locked(&mut st, socket, true, Some(PEER_LEFT_REQUEUE));
            self.leave_group_locked(&mut st, socket, Some(PEER_LEFT_REQUEUE));

            let now = now_ms();
            let self_peer = QueuePeer {
                socket,
                preferences: preferences.clone(),
                user_id,
                email,
                session_key,
                joined_at: now,
                last_beat: now,
            };
            st.peer_meta.insert(socket, self_peer.clone());

            // A group-scoped search never takes a solo partner.
            let mut best_idx: Option<usize> = None;
            let mut best_score = -1i64;
            if preferences.match_scope != MatchScope::Group {
                for (i, candidate) in st.waiting_peers.iter().enumerate() {
                    if candidate.preferences.match_scope == MatchScope::Group {
                        continue;
                    }
                    if !st.compatible(&self_peer, candidate) {
                        continue;
                    }
                    let s = interest_score(
                        &self_peer.preferences.interests,
                        &candidate.preferences.interests,
                    );
                    if s > best_score {
                        best_score = s;
                        best_idx = Some(i);
                    }
                }
            }

            match best_idx {
                Some(idx) => {
                    let partner = st.waiting_peers.remove(idx);
                    st.remember_pair(&self_peer, &partner);

                    let room = Room {
                        id: st.new_room_id(),
                        a: socket,
                        b: partner.socket,
                        a_user_id: self_peer.user_id,
                        b_user_id: partner.user_id,
                        created_at: now_ms(),
                    };
                    st.partners.insert(socket, partner.socket);
                    st.partners.insert(partner.socket, socket);
                    st.rooms_by_socket.insert(socket, room.clone());
                    st.rooms_by_socket.insert(partner.socket, room.clone());

                    let shared: Vec<String> = preferences
                        .interests
                        .iter()
                        .filter(|x| partner.preferences.interests.contains(x))
                        .cloned()
                        .collect();
                    Some((room, self_peer, partner, shared))
                }
                None => {
                    // No solo partner: try a waiting group, unless solo-scoped.
                    if preferences.match_scope != MatchScope::Solo {
                        if let Some(group_id) = self.find_best_group_for_solo(&st, &self_peer) {
                            let created_at = st
                                .group_rooms
                                .get(&group_id)
                                .map(|g| g.created_at)
                                .unwrap_or_else(now_ms);
                            self.merge_solo_with_group(&mut st, self_peer, &group_id);
                            observe_ms("match_wait", (now_ms() - created_at) as f64);
                            self.broadcast_stats(&st);
                            return;
                        }
                    }

                    st.waiting_peers.push(self_peer);
                    inc("queue_joins", 1);
                    let position = st.waiting_peers.len() as i64;
                    let online = st.queue_stats().online;
                    self.send(
                        socket,
                        &ServerMessage::QueueWaiting {
                            position: Some(position),
                            online: Some(online),
                        },
                    );
                    self.broadcast_stats(&st);
                    None
                }
            }
        };

        let Some((room, self_peer, partner, shared)) = matched else {
            return;
        };

        let (rel_self, rel_partner) = self.relationship_pair(self_peer.user_id, partner.user_id).await;

        self.send(
            socket,
            &ServerMessage::RoomMatched {
                room_id: room.id.clone(),
                role: Role::Offerer,
                peer_country: Some(partner.preferences.country.clone()),
                peer_email: partner.email.clone(),
                peer_user_id: partner.user_id,
                shared_interests: Some(shared.clone()),
                relationship: Some(rel_self),
            },
        );
        self.send(
            partner.socket,
            &ServerMessage::RoomMatched {
                room_id: room.id,
                role: Role::Answerer,
                peer_country: Some(self_peer.preferences.country.clone()),
                peer_email: self_peer.email.clone(),
                peer_user_id: self_peer.user_id,
                shared_interests: Some(shared),
                relationship: Some(rel_partner),
            },
        );

        observe_ms("match_wait", (now_ms() - partner.joined_at) as f64);
        inc("matches_total", 1);
        let st = self.state.lock().await;
        self.broadcast_stats(&st);
    }

    /// Both directions of the relationship, or `none/none` for guests.
    async fn relationship_pair(
        &self,
        a: Option<i64>,
        b: Option<i64>,
    ) -> (RelationshipStatus, RelationshipStatus) {
        let (Some(a), Some(b)) = (a, b) else {
            return (RelationshipStatus::None, RelationshipStatus::None);
        };
        let rel_a = get_relationship(&self.db, a, b)
            .await
            .unwrap_or(RelationshipStatus::None);
        let rel_b = get_relationship(&self.db, b, a)
            .await
            .unwrap_or(RelationshipStatus::None);
        (rel_a, rel_b)
    }

    pub async fn heartbeat(&self, socket: SocketId) {
        let mut st = self.state.lock().await;
        let now = now_ms();
        if let Some(meta) = st.peer_meta.get_mut(&socket) {
            meta.last_beat = now;
        }

        if let Some(idx) = st.waiting_peers.iter().position(|p| p.socket == socket) {
            st.waiting_peers[idx].last_beat = now;
            // A waiting solo peer re-checks the group queue on every beat; a
            // group may have formed since they joined.
            if st.waiting_peers[idx].preferences.match_scope != MatchScope::Solo {
                let peer = st.waiting_peers[idx].clone();
                if let Some(group_id) = self.find_best_group_for_solo(&st, &peer) {
                    st.waiting_peers.remove(idx);
                    self.merge_solo_with_group(&mut st, peer, &group_id);
                    self.broadcast_stats(&st);
                }
            }
            return;
        }

        if let Some(room_id) = st.group_room_of_socket.get(&socket).cloned() {
            if st.group_rooms.get(&room_id).is_some_and(|g| g.in_queue) {
                self.try_match_group(&mut st, &room_id);
            }
        }
    }

    /// Drops peers that stopped sending heartbeats.
    pub async fn purge_stale(&self, max_age_ms: u64) {
        let mut st = self.state.lock().await;
        let now = now_ms();
        let stale: Vec<QueuePeer> = st
            .waiting_peers
            .iter()
            .filter(|p| now.saturating_sub(p.last_beat) > max_age_ms)
            .cloned()
            .collect();
        st.waiting_peers
            .retain(|p| now.saturating_sub(p.last_beat) <= max_age_ms);
        for peer in stale {
            self.send(
                peer.socket,
                &ServerMessage::Error {
                    code: "queue_timeout".into(),
                    message: "Queue timed out. Try again.".into(),
                },
            );
            st.peer_meta.remove(&peer.socket);
        }
    }
}

// ---------------------------------------------------------------------------
// Group matchmaking
// ---------------------------------------------------------------------------

impl Engine {
    /// Creates a pre-match lobby hosted by `socket`.
    ///
    /// The argument list mirrors the TypeScript signature (socket, visibility,
    /// preferences, then the opts bag) so the two can be diffed side by side;
    /// bundling them into a struct here would obscure that.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_group_match_room(
        &self,
        socket: SocketId,
        visibility: GroupVisibility,
        preferences: MatchPreferences,
        user_id: Option<i64>,
        email: Option<String>,
        session_key: String,
        skip_leave_room: bool,
        group_leave_reason: Option<&str>,
    ) -> String {
        let mut st = self.state.lock().await;
        self.leave_group_locked(&mut st, socket, group_leave_reason);
        if !skip_leave_room {
            self.leave_room_locked(&mut st, socket, true, Some(PEER_LEFT_GROUP_INVITE));
        }

        let room_id = st.new_group_room_id();
        let group = GroupRoom {
            id: room_id.clone(),
            host_socket: socket,
            host_user_id: user_id,
            host_email: email.clone(),
            visibility,
            scope: preferences.match_scope,
            preferences: preferences.clone(),
            participants: vec![GroupParticipant {
                socket,
                user_id,
                email,
                preferences,
                session_key,
                peer_id: None,
            }],
            created_at: now_ms(),
            in_queue: false,
            matched: false,
            searching: false,
        };
        st.group_rooms.insert(room_id.clone(), group);
        st.group_room_of_socket.insert(socket, room_id.clone());

        self.send(
            socket,
            &ServerMessage::GroupMatchCreated {
                room_id: room_id.clone(),
                visibility,
            },
        );
        room_id
    }

    pub async fn add_participant_to_group(
        &self,
        room_id: &str,
        socket: SocketId,
        preferences: MatchPreferences,
        user_id: Option<i64>,
        email: Option<String>,
        session_key: String,
    ) {
        let mut st = self.state.lock().await;

        // Clear any prior match/queue state for the joining socket.
        Self::remove_from_queue_locked(&mut st, socket);
        if st.rooms_by_socket.contains_key(&socket) {
            if let Some(partner) = st.partners.remove(&socket) {
                st.partners.remove(&partner);
                st.rooms_by_socket.remove(&partner);
                self.send(
                    partner,
                    &ServerMessage::RoomPeerLeft {
                        reason: Some(PEER_LEFT_REQUEUE.into()),
                    },
                );
            }
            st.rooms_by_socket.remove(&socket);
        }

        let (visibility, existing): (GroupVisibility, Vec<SocketId>) = {
            let Some(group) = st.group_rooms.get_mut(room_id) else {
                return;
            };
            let existing = group.participants.iter().map(|p| p.socket).collect();
            group.upsert_participant(GroupParticipant {
                socket,
                user_id,
                email: email.clone(),
                preferences,
                session_key,
                peer_id: None,
            });
            (group.visibility, existing)
        };
        st.group_room_of_socket.insert(socket, room_id.to_string());

        let joined = ServerMessage::GroupMatchParticipantJoined {
            room_id: room_id.to_string(),
            user_id: user_id.unwrap_or(0),
            email,
        };
        for sock in existing {
            self.send(sock, &joined);
        }
        self.send(
            socket,
            &ServerMessage::GroupMatchCreated {
                room_id: room_id.to_string(),
                visibility,
            },
        );

        // A lobby of two or more enters the queue automatically.
        let size = st
            .group_rooms
            .get(room_id)
            .map(|g| g.participants.len())
            .unwrap_or(0);
        if size >= 2 {
            let already_queued = st.group_rooms.get(room_id).is_some_and(|g| g.in_queue);
            if !already_queued {
                self.enqueue_group(&mut st, room_id);
            }
            self.try_match_group(&mut st, room_id);
        }
    }

    /// Explicit "start searching" for a lobby that has not auto-queued.
    pub async fn start_group_match(&self, room_id: &str) {
        let mut st = self.state.lock().await;
        if st.group_rooms.get(room_id).is_some_and(|g| g.in_queue) {
            return;
        }
        self.enqueue_group(&mut st, room_id);
        self.try_match_group(&mut st, room_id);
    }

    fn enqueue_group(&self, st: &mut EngineState, room_id: &str) {
        if let Some(group) = st.group_rooms.get_mut(room_id) {
            group.in_queue = true;
        }
        st.waiting_groups.push(room_id.to_string());

        let position = st.waiting_groups.len() as i64;
        let online = st.queue_stats().online;
        let sockets: Vec<SocketId> = st
            .group_rooms
            .get(room_id)
            .map(|g| g.participants.iter().map(|p| p.socket).collect())
            .unwrap_or_default();
        for sock in sockets {
            self.send(
                sock,
                &ServerMessage::QueueWaiting {
                    position: Some(position),
                    online: Some(online),
                },
            );
        }
    }

    fn try_match_group(&self, st: &mut EngineState, room_id: &str) {
        if !st.group_rooms.get(room_id).is_some_and(|g| g.in_queue) {
            return;
        }

        // Best opposing group first.
        let mut best: Option<String> = None;
        let mut best_score = -1i64;
        for candidate_id in st.waiting_groups.clone() {
            if candidate_id == room_id {
                continue;
            }
            if !self.group_to_group_compatible(st, room_id, &candidate_id) {
                continue;
            }
            let s = self.group_pair_score(st, room_id, &candidate_id);
            if s > best_score {
                best_score = s;
                best = Some(candidate_id);
            }
        }
        if let Some(other) = best {
            self.merge_groups_and_match(st, room_id, &other);
            return;
        }

        // Then a waiting solo, unless the room is group-only.
        let scope = st.group_rooms.get(room_id).map(|g| g.scope);
        if scope != Some(MatchScope::Group) {
            if let Some(idx) = self.find_best_solo_for_group(st, room_id) {
                let peer = st.waiting_peers.remove(idx);
                self.merge_solo_with_group(st, peer, room_id);
                return;
            }
        }

        // Nobody to face yet: connect the room's own members so they see each
        // other, but keep the room queued and their UI showing "searching" for
        // the opposing side. `matched` guards re-entry.
        let (size, matched) = st
            .group_rooms
            .get(room_id)
            .map(|g| (g.participants.len(), g.matched))
            .unwrap_or((0, true));
        if size >= 2 && !matched {
            st.dequeue_group(room_id);
            let side = self.to_side(st, room_id);
            let shared = compute_shared_interests(&[side.clone()].concat());
            self.notify_group_match(st, vec![side], shared, Some(room_id.to_string()));
            inc("matches_total", 1);
        }
    }

    fn to_side(&self, st: &EngineState, room_id: &str) -> Vec<SideParticipant> {
        st.group_rooms
            .get(room_id)
            .map(|g| {
                g.participants
                    .iter()
                    .map(|p| SideParticipant {
                        socket: p.socket,
                        user_id: p.user_id,
                        email: p.email.clone(),
                        preferences: p.preferences.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn group_pair_score(&self, st: &EngineState, a: &str, b: &str) -> i64 {
        let (Some(ga), Some(gb)) = (st.group_rooms.get(a), st.group_rooms.get(b)) else {
            return 0;
        };
        let mut total = 0;
        for pa in &ga.participants {
            for pb in &gb.participants {
                total += interest_score(&pa.preferences.interests, &pb.preferences.interests);
            }
        }
        total
    }

    /// Every member of one side must be compatible with every member of the
    /// other — one incompatible pair rejects the whole match.
    fn group_to_group_compatible(&self, st: &EngineState, a: &str, b: &str) -> bool {
        let (Some(ga), Some(gb)) = (st.group_rooms.get(a), st.group_rooms.get(b)) else {
            return false;
        };
        for pa in &ga.participants {
            for pb in &gb.participants {
                let peer_a = participant_as_peer(pa);
                let peer_b = participant_as_peer(pb);
                if !st.compatible(&peer_a, &peer_b) {
                    return false;
                }
            }
        }
        true
    }

    fn group_peer_compatible(&self, st: &EngineState, peer: &QueuePeer, room_id: &str) -> bool {
        let Some(group) = st.group_rooms.get(room_id) else {
            return false;
        };
        group
            .participants
            .iter()
            .all(|p| st.compatible(peer, &participant_as_peer(p)))
    }

    fn find_best_solo_for_group(&self, st: &EngineState, room_id: &str) -> Option<usize> {
        let group_prefs = aggregate_group_preferences(st, room_id)?;
        let mut best: Option<usize> = None;
        let mut best_score = -1i64;
        for (i, candidate) in st.waiting_peers.iter().enumerate() {
            if candidate.preferences.match_scope == MatchScope::Solo {
                continue;
            }
            if !self.group_peer_compatible(st, candidate, room_id) {
                continue;
            }
            if !preferences_compatible(&candidate.preferences, &group_prefs) {
                continue;
            }
            let s = interest_score(&candidate.preferences.interests, &group_prefs.interests);
            if s > best_score {
                best_score = s;
                best = Some(i);
            }
        }
        best
    }

    fn find_best_group_for_solo(&self, st: &EngineState, peer: &QueuePeer) -> Option<String> {
        let mut best: Option<String> = None;
        let mut best_score = -1i64;
        for room_id in &st.waiting_groups {
            let Some(group) = st.group_rooms.get(room_id) else {
                continue;
            };
            if group.scope == MatchScope::Group {
                continue;
            }
            if !self.group_peer_compatible(st, peer, room_id) {
                continue;
            }
            let Some(group_prefs) = aggregate_group_preferences(st, room_id) else {
                continue;
            };
            if !preferences_compatible(&peer.preferences, &group_prefs) {
                continue;
            }
            let s = interest_score(&peer.preferences.interests, &group_prefs.interests);
            if s > best_score {
                best_score = s;
                best = Some(room_id.clone());
            }
        }
        best
    }

    fn merge_solo_with_group(&self, st: &mut EngineState, peer: QueuePeer, room_id: &str) {
        st.waiting_peers.retain(|p| p.socket != peer.socket);
        st.dequeue_group(room_id);

        let group_side = self.to_side(st, room_id);
        let solo_side = vec![SideParticipant {
            socket: peer.socket,
            user_id: peer.user_id,
            email: peer.email.clone(),
            preferences: peer.preferences.clone(),
        }];

        let all: Vec<SideParticipant> = [group_side.clone(), solo_side.clone()].concat();
        let shared = compute_shared_interests(&all);
        self.notify_group_match(st, vec![group_side, solo_side], shared, None);

        inc("matches_total", 1);
        if peer.user_id.is_some() {
            if let Some(group) = st.group_rooms.get(room_id) {
                let host = QueuePeer {
                    socket: group.host_socket,
                    preferences: group.preferences.clone(),
                    user_id: group.host_user_id,
                    email: group.host_email.clone(),
                    session_key: String::new(),
                    joined_at: 0,
                    last_beat: 0,
                };
                st.remember_pair(&peer, &host);
            }
        }
    }

    fn merge_groups_and_match(&self, st: &mut EngineState, a: &str, b: &str) {
        st.dequeue_group(a);
        st.dequeue_group(b);

        let side_a = self.to_side(st, a);
        let side_b = self.to_side(st, b);
        let shared = compute_shared_interests(&[side_a.clone(), side_b.clone()].concat());
        self.notify_group_match(st, vec![side_a, side_b], shared, None);
        inc("matches_total", 1);
    }

    /// Wires every participant into one mesh room and tells each client who is
    /// on its own side and who is opposing.
    ///
    /// `keep_searching_from` means there is only one side (the room's own
    /// members): the unified room goes back into the queue so it can still find
    /// an opponent, and everyone gets a fresh `queue:waiting` so the UI keeps
    /// its "searching" placeholder.
    fn notify_group_match(
        &self,
        st: &mut EngineState,
        sides: Vec<Vec<SideParticipant>>,
        shared_interests: Vec<String>,
        keep_searching_from: Option<String>,
    ) {
        // Drop participants whose socket has already gone away.
        let open_sides: Vec<Vec<SideParticipant>> = sides
            .into_iter()
            .map(|side| {
                side.into_iter()
                    .filter(|p| self.hub.socket_by_id(p.socket).is_some())
                    .collect::<Vec<_>>()
            })
            .filter(|side: &Vec<SideParticipant>| !side.is_empty())
            .collect();

        let participants: Vec<(usize, SideParticipant)> = open_sides
            .iter()
            .flatten()
            .cloned()
            .enumerate()
            .collect();
        if participants.len() < 2 {
            return;
        }

        let matched_room_id = st.new_room_id();

        // Detach everyone from whatever room they were in.
        for (_, p) in &participants {
            if let Some(old_id) = st.group_room_of_socket.remove(&p.socket) {
                if let Some(old) = st.group_rooms.get_mut(&old_id) {
                    old.remove_participant(p.socket);
                    if old.participants.is_empty() {
                        st.group_rooms.remove(&old_id);
                        st.waiting_groups.retain(|id| *id != old_id);
                    }
                }
            }
            if let Some(stale) = st.rooms_by_socket.remove(&p.socket) {
                st.rooms_by_socket.remove(&stale.a);
                st.rooms_by_socket.remove(&stale.b);
                st.partners.remove(&p.socket);
            }
        }

        let keep = keep_searching_from
            .as_ref()
            .and_then(|id| st.group_rooms.get(id).cloned());
        let first = &participants[0].1;
        let unified = GroupRoom {
            id: matched_room_id.clone(),
            host_socket: first.socket,
            host_user_id: first.user_id,
            host_email: first.email.clone(),
            visibility: keep.as_ref().map(|g| g.visibility).unwrap_or(GroupVisibility::Public),
            scope: keep.as_ref().map(|g| g.scope).unwrap_or(MatchScope::All),
            preferences: keep
                .as_ref()
                .map(|g| g.preferences.clone())
                .unwrap_or_else(|| first.preferences.clone()),
            participants: participants
                .iter()
                .map(|(index, p)| GroupParticipant {
                    socket: p.socket,
                    user_id: Some(p.user_id.unwrap_or(0)),
                    email: p.email.clone(),
                    preferences: p.preferences.clone(),
                    session_key: String::new(),
                    peer_id: Some(*index as i64),
                })
                .collect(),
            created_at: now_ms(),
            in_queue: false,
            matched: true,
            searching: keep_searching_from.is_some(),
        };
        for (_, p) in &participants {
            st.group_room_of_socket
                .insert(p.socket, matched_room_id.clone());
        }
        st.group_rooms.insert(matched_room_id.clone(), unified);

        let mut side_of: HashMap<SocketId, usize> = HashMap::new();
        for (side_idx, side) in open_sides.iter().enumerate() {
            for p in side {
                side_of.insert(p.socket, side_idx);
            }
        }

        for (self_index, self_p) in &participants {
            let self_side = side_of.get(&self_p.socket).copied().unwrap_or(0);
            let peers: Vec<GroupMatchPeer> = participants
                .iter()
                .filter(|(_, p)| p.socket != self_p.socket)
                .map(|(index, p)| GroupMatchPeer {
                    peer_id: *index as i64,
                    user_id: p.user_id.unwrap_or(0),
                    email: p.email.clone(),
                    // `any` is the default, so it carries no information.
                    country: (p.preferences.country != DEFAULT_COUNTRY)
                        .then(|| p.preferences.country.clone()),
                    // The lower index offers, so exactly one side of each pair
                    // creates the WebRTC offer.
                    role: if self_index < index { Role::Offerer } else { Role::Answerer },
                    side: Some(if side_of.get(&p.socket).copied().unwrap_or(0) == self_side {
                        Side::Local
                    } else {
                        Side::Remote
                    }),
                })
                .collect();

            self.send(
                self_p.socket,
                &ServerMessage::GroupMatchMatched {
                    room_id: matched_room_id.clone(),
                    role: if *self_index == 0 { Role::Offerer } else { Role::Answerer },
                    peer_id: *self_index as i64,
                    peers,
                    shared_interests: shared_interests.clone(),
                },
            );
        }

        if keep_searching_from.is_some() {
            if let Some(group) = st.group_rooms.get_mut(&matched_room_id) {
                group.in_queue = true;
            }
            st.waiting_groups.push(matched_room_id.clone());
            let position = st.waiting_groups.len() as i64;
            let online = st.queue_stats().online;
            for (_, p) in &participants {
                self.send(
                    p.socket,
                    &ServerMessage::QueueWaiting {
                        position: Some(position),
                        online: Some(online),
                    },
                );
            }
        }
    }
}

fn participant_as_peer(p: &GroupParticipant) -> QueuePeer {
    QueuePeer {
        socket: p.socket,
        preferences: p.preferences.clone(),
        user_id: p.user_id,
        email: p.email.clone(),
        session_key: p.session_key.clone(),
        joined_at: 0,
        last_beat: 0,
    }
}

/// One representative preference set for a whole room: the union of interests,
/// and the first non-`any` country/language anyone asked for.
fn aggregate_group_preferences(st: &EngineState, room_id: &str) -> Option<MatchPreferences> {
    let group = st.group_rooms.get(room_id)?;
    let mut interests: Vec<String> = Vec::new();
    let mut country = DEFAULT_COUNTRY.to_string();
    let mut language = DEFAULT_LANGUAGE.to_string();
    for p in &group.participants {
        for i in &p.preferences.interests {
            if !interests.contains(i) {
                interests.push(i.clone());
            }
        }
        if p.preferences.country != DEFAULT_COUNTRY {
            country = p.preferences.country.clone();
        }
        if p.preferences.language != DEFAULT_LANGUAGE {
            language = p.preferences.language.clone();
        }
    }
    interests.truncate(10);
    Some(MatchPreferences {
        country,
        language,
        gender: group.preferences.gender,
        looking_for: group.preferences.looking_for,
        interests,
        allow_match_with_same_users: true,
        mode: crate::proto::MatchMode::Group,
        match_scope: group.scope,
    })
}

/// An interest is "shared" when at least half the participants list it.
fn compute_shared_interests(participants: &[SideParticipant]) -> Vec<String> {
    let total = participants.len();
    if total == 0 {
        return Vec::new();
    }
    let mut counts: Vec<(String, usize)> = Vec::new();
    for p in participants {
        for interest in &p.preferences.interests {
            match counts.iter_mut().find(|(k, _)| k == interest) {
                Some((_, n)) => *n += 1,
                None => counts.push((interest.clone(), 1)),
            }
        }
    }
    counts
        .into_iter()
        .filter(|(_, count)| *count as f64 >= total as f64 * 0.5)
        .map(|(k, _)| k)
        .collect()
}

#[cfg(test)]
mod engine_tests {
    use super::*;
    use crate::proto::MatchMode;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

    async fn engine() -> (Engine, Arc<Hub>) {
        let hub = Arc::new(Hub::new());
        let db = Arc::new(Db::open(":memory:").await.expect("in-memory db"));
        db.migrate().await.expect("migrate");
        (Engine::new(Arc::clone(&hub), db), hub)
    }

    fn socket(hub: &Hub) -> (SocketId, UnboundedReceiver<String>) {
        let (tx, rx) = unbounded_channel();
        (hub.connect(tx).id, rx)
    }

    fn prefs() -> MatchPreferences {
        MatchPreferences {
            country: "any".into(),
            language: "any".into(),
            gender: Gender::Any,
            looking_for: Gender::Any,
            interests: vec![],
            allow_match_with_same_users: true,
            mode: MatchMode::Solo,
            match_scope: MatchScope::All,
        }
    }

    fn with(prefs_fn: impl FnOnce(&mut MatchPreferences)) -> MatchPreferences {
        let mut p = prefs();
        prefs_fn(&mut p);
        p
    }

    /// Drains a receiver into the list of frame `type` values seen so far.
    fn frames(rx: &mut UnboundedReceiver<String>) -> Vec<String> {
        let mut out = Vec::new();
        while let Ok(raw) = rx.try_recv() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
                    out.push(t.to_string());
                }
            }
        }
        out
    }

    #[tokio::test]
    async fn the_first_peer_waits_and_the_second_is_matched() {
        let (engine, hub) = engine().await;
        let (a, mut ra) = socket(&hub);
        let (b, mut rb) = socket(&hub);

        engine.join_queue(a, prefs(), Some(1), None, "sa".into()).await;
        assert_eq!(frames(&mut ra), vec!["queue:waiting", "stats"]);
        assert_eq!(engine.queue_stats().await.waiting, 1);

        engine.join_queue(b, prefs(), Some(2), None, "sb".into()).await;
        assert!(frames(&mut rb).contains(&"room:matched".to_string()));
        assert!(frames(&mut ra).contains(&"room:matched".to_string()));
        assert_eq!(engine.queue_stats().await.waiting, 0, "both left the queue");
        assert_eq!(engine.partner_of(a).await, Some(b));
        assert_eq!(engine.partner_user_id(a).await, Some(2));
    }

    #[tokio::test]
    async fn incompatible_preferences_keep_both_waiting() {
        let (engine, hub) = engine().await;
        let (a, _ra) = socket(&hub);
        let (b, _rb) = socket(&hub);

        engine
            .join_queue(a, with(|p| p.country = "PE".into()), Some(1), None, "sa".into())
            .await;
        engine
            .join_queue(b, with(|p| p.country = "US".into()), Some(2), None, "sb".into())
            .await;

        assert_eq!(engine.queue_stats().await.waiting, 2);
        assert_eq!(engine.partner_of(a).await, None);
    }

    #[tokio::test]
    async fn a_blocked_pair_is_never_matched() {
        let (engine, hub) = engine().await;
        let (a, _ra) = socket(&hub);
        let (b, _rb) = socket(&hub);
        engine.block_pair(1, 2).await;

        engine.join_queue(a, prefs(), Some(1), None, "sa".into()).await;
        engine.join_queue(b, prefs(), Some(2), None, "sb".into()).await;
        assert_eq!(engine.queue_stats().await.waiting, 2, "blocked stays queued");

        engine.unblock_pair(1, 2).await;
        let (c, _rc) = socket(&hub);
        engine.join_queue(c, prefs(), Some(3), None, "sc".into()).await;
        assert!(engine.partner_of(c).await.is_some());
    }

    /// The cooldown only applies when the peer opted out of rematching.
    #[tokio::test]
    async fn the_rematch_cooldown_is_opt_in() {
        let (engine, hub) = engine().await;
        let no_rematch = with(|p| p.allow_match_with_same_users = false);

        let (a, _ra) = socket(&hub);
        let (b, _rb) = socket(&hub);
        engine.join_queue(a, no_rematch.clone(), Some(1), None, "sa".into()).await;
        engine.join_queue(b, no_rematch.clone(), Some(2), None, "sb".into()).await;
        assert!(engine.partner_of(a).await.is_some(), "first match is allowed");

        // Re-queue the same two users: the cooldown now blocks them.
        engine.join_queue(a, no_rematch.clone(), Some(1), None, "sa".into()).await;
        engine.join_queue(b, no_rematch, Some(2), None, "sb".into()).await;
        assert_eq!(engine.queue_stats().await.waiting, 2, "cooldown holds them apart");
    }

    #[tokio::test]
    async fn higher_interest_overlap_wins_the_partner() {
        let (engine, hub) = engine().await;
        let (poor, _rp) = socket(&hub);
        let (rich, _rr) = socket(&hub);
        let (seeker, _rs) = socket(&hub);

        // The two candidates must not match EACH OTHER first, or the queue is
        // empty by the time the seeker arrives — hence the opposed countries.
        let tags = |country: &str, v: &[&str]| {
            with(|p| {
                p.country = country.into();
                p.interests = v.iter().map(|s| s.to_string()).collect();
            })
        };

        engine.join_queue(poor, tags("PE", &["music"]), Some(1), None, "s1".into()).await;
        engine
            .join_queue(rich, tags("US", &["music", "tech", "art"]), Some(2), None, "s2".into())
            .await;
        assert_eq!(engine.queue_stats().await.waiting, 2, "candidates stay apart");

        engine
            .join_queue(seeker, tags("any", &["music", "tech", "art"]), Some(3), None, "s3".into())
            .await;

        assert_eq!(
            engine.partner_of(seeker).await,
            Some(rich),
            "the three-way overlap beats the one-way"
        );
    }

    #[tokio::test]
    async fn a_group_scoped_peer_is_not_paired_with_a_solo_one() {
        let (engine, hub) = engine().await;
        let (a, _ra) = socket(&hub);
        let (b, _rb) = socket(&hub);

        engine
            .join_queue(a, with(|p| p.match_scope = MatchScope::Group), Some(1), None, "sa".into())
            .await;
        engine
            .join_queue(b, with(|p| p.match_scope = MatchScope::Solo), Some(2), None, "sb".into())
            .await;
        assert_eq!(engine.queue_stats().await.waiting, 2);
    }

    #[tokio::test]
    async fn leaving_a_room_notifies_the_partner() {
        let (engine, hub) = engine().await;
        let (a, _ra) = socket(&hub);
        let (b, mut rb) = socket(&hub);
        engine.join_queue(a, prefs(), Some(1), None, "sa".into()).await;
        engine.join_queue(b, prefs(), Some(2), None, "sb".into()).await;
        let _ = frames(&mut rb);

        engine.leave_room(a, true, Some(PEER_LEFT_DISCONNECT)).await;
        assert!(frames(&mut rb).contains(&"room:peer-left".to_string()));
        assert_eq!(engine.partner_of(b).await, None);
    }

    #[tokio::test]
    async fn a_lobby_of_two_connects_its_own_members_and_keeps_searching() {
        let (engine, hub) = engine().await;
        let (host, mut rh) = socket(&hub);
        let (guest, mut rg) = socket(&hub);

        let room = engine
            .create_group_match_room(
                host,
                GroupVisibility::Public,
                prefs(),
                Some(1),
                None,
                "sh".into(),
                false,
                None,
            )
            .await;
        assert!(frames(&mut rh).contains(&"group-match:created".to_string()));

        engine
            .add_participant_to_group(&room, guest, prefs(), Some(2), None, "sg".into())
            .await;

        // Both are wired into a mesh, and the room stays queued for an opponent.
        let guest_frames = frames(&mut rg);
        assert!(guest_frames.contains(&"group-match:matched".to_string()));
        assert!(
            guest_frames.contains(&"queue:waiting".to_string()),
            "still searching for the opposing side"
        );
        assert!(frames(&mut rh).contains(&"group-match:matched".to_string()));
    }

    #[tokio::test]
    async fn a_solo_peer_joins_a_waiting_group() {
        let (engine, hub) = engine().await;
        let (host, _rh) = socket(&hub);
        let (guest, _rg) = socket(&hub);
        let (solo, mut rs) = socket(&hub);

        let room = engine
            .create_group_match_room(
                host,
                GroupVisibility::Public,
                prefs(),
                Some(1),
                None,
                "sh".into(),
                false,
                None,
            )
            .await;
        engine
            .add_participant_to_group(&room, guest, prefs(), Some(2), None, "sg".into())
            .await;

        engine.join_queue(solo, prefs(), Some(3), None, "ss".into()).await;
        let solo_frames = frames(&mut rs);
        assert!(
            solo_frames.contains(&"group-match:matched".to_string()),
            "the solo peer is merged into the group, got {solo_frames:?}"
        );
    }

    #[tokio::test]
    async fn the_host_leaving_a_lobby_dissolves_it() {
        let (engine, hub) = engine().await;
        let (host, _rh) = socket(&hub);
        let (guest, mut rg) = socket(&hub);

        let room = engine
            .create_group_match_room(
                host,
                GroupVisibility::Private,
                // Group-scoped so the pair does not immediately self-match.
                with(|p| p.match_scope = MatchScope::Group),
                Some(1),
                None,
                "sh".into(),
                false,
                None,
            )
            .await;
        engine
            .add_participant_to_group(
                &room,
                guest,
                with(|p| p.match_scope = MatchScope::Group),
                Some(2),
                None,
                "sg".into(),
            )
            .await;
        let _ = frames(&mut rg);

        engine.leave_group(host, None).await;
        // The lobby self-matched its members first, so the guest is told the
        // peer left either way; the room itself must be gone.
        let _ = frames(&mut rg);
        assert!(engine.group_room_by_id(&room).await.is_none());
    }

    #[tokio::test]
    async fn stale_peers_are_purged_with_a_timeout_error() {
        let (engine, hub) = engine().await;
        let (a, mut ra) = socket(&hub);
        engine.join_queue(a, prefs(), Some(1), None, "sa".into()).await;
        let _ = frames(&mut ra);

        // The check is `now - last_beat > max_age`, so the window has to
        // actually elapse — a zero-length one does not on a fast machine.
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        engine.purge_stale(1).await;
        assert_eq!(engine.queue_stats().await.waiting, 0);
        assert!(frames(&mut ra).contains(&"error".to_string()));
    }

    #[tokio::test]
    async fn full_remove_clears_every_trace_of_a_socket() {
        let (engine, hub) = engine().await;
        let (a, _ra) = socket(&hub);
        let (b, _rb) = socket(&hub);
        engine.join_queue(a, prefs(), Some(1), None, "sa".into()).await;
        engine.join_queue(b, prefs(), Some(2), None, "sb".into()).await;

        engine.full_remove(a).await;
        assert_eq!(engine.partner_of(a).await, None);
        assert_eq!(engine.partner_of(b).await, None);
        assert!(engine.meta_of(a).await.is_none());
        assert_eq!(engine.queue_stats().await.waiting, 0);
    }

    #[tokio::test]
    async fn shared_interests_need_half_the_room() {
        let side = |tags: &[&str]| SideParticipant {
            socket: 0,
            user_id: None,
            email: None,
            preferences: with(|p| p.interests = tags.iter().map(|s| s.to_string()).collect()),
        };
        let people = vec![side(&["music", "tech"]), side(&["music"]), side(&["art"])];
        let shared = compute_shared_interests(&people);
        assert!(shared.contains(&"music".to_string()), "2 of 3");
        assert!(!shared.contains(&"art".to_string()), "1 of 3 is below half");
        assert!(!shared.contains(&"tech".to_string()));
    }
}

// ---------------------------------------------------------------------------
// Direct matching (invitation accept) and relays
// ---------------------------------------------------------------------------

impl Engine {
    /// Builds a queue peer from the user's stored profile, for matches that do
    /// not come from the queue (an accepted invitation).
    async fn build_peer(&self, user_id: i64, socket: SocketId) -> Option<QueuePeer> {
        if let Some(meta) = self.state.lock().await.peer_meta.get(&socket) {
            return Some(meta.clone());
        }
        let mut rows = self
            .db
            .conn()
            .query(
                "SELECT email, gender, country, language, interests FROM users WHERE id = ?",
                libsql::params![user_id],
            )
            .await
            .ok()?;
        let row = rows.next().await.ok()??;

        let interests: Vec<String> = row
            .get::<String>(4)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let preferences = normalize_preferences(&serde_json::json!({
            "gender": row.get::<String>(1).unwrap_or_default(),
            "country": row.get::<String>(2).unwrap_or_default(),
            "language": row.get::<String>(3).unwrap_or_default(),
            "interests": interests,
            "lookingFor": "any",
            "mode": "solo",
            "matchScope": "all",
        }))?;

        let now = now_ms();
        Some(QueuePeer {
            socket,
            preferences,
            user_id: Some(user_id),
            email: row.get::<String>(0).ok(),
            session_key: String::new(),
            joined_at: now,
            last_beat: now,
        })
    }

    /// Pairs two signed-in users directly, bypassing the queue. Used when an
    /// invitation is accepted. Delivers to every socket each user has open so
    /// the match appears in all their tabs.
    pub async fn match_users(&self, a_user_id: i64, b_user_id: i64) -> bool {
        let a_sockets: Vec<SocketId> = self
            .hub
            .sockets_for_user(a_user_id)
            .into_iter()
            .map(|h| h.id)
            .collect();
        let b_sockets: Vec<SocketId> = self
            .hub
            .sockets_for_user(b_user_id)
            .into_iter()
            .map(|h| h.id)
            .collect();
        let (Some(&a_socket), Some(&b_socket)) = (a_sockets.first(), b_sockets.first()) else {
            return false;
        };

        let (Some(a_meta), Some(b_meta)) = (
            self.build_peer(a_user_id, a_socket).await,
            self.build_peer(b_user_id, b_socket).await,
        ) else {
            return false;
        };

        let room_id = {
            let mut st = self.state.lock().await;
            for s in a_sockets.iter().chain(b_sockets.iter()) {
                self.leave_room_locked(&mut st, *s, false, Some(PEER_LEFT_LEAVE));
            }
            let room = Room {
                id: st.new_room_id(),
                a: a_socket,
                b: b_socket,
                a_user_id: Some(a_user_id),
                b_user_id: Some(b_user_id),
                created_at: now_ms(),
            };
            st.partners.insert(a_socket, b_socket);
            st.partners.insert(b_socket, a_socket);
            st.rooms_by_socket.insert(a_socket, room.clone());
            st.rooms_by_socket.insert(b_socket, room.clone());
            room.id
        };

        let shared: Vec<String> = a_meta
            .preferences
            .interests
            .iter()
            .filter(|x| b_meta.preferences.interests.contains(x))
            .cloned()
            .collect();
        let (rel_a, rel_b) = self.relationship_pair(Some(a_user_id), Some(b_user_id)).await;

        let payload_a = ServerMessage::RoomMatched {
            room_id: room_id.clone(),
            role: Role::Offerer,
            peer_country: Some(b_meta.preferences.country.clone()),
            peer_email: b_meta.email.clone(),
            peer_user_id: Some(b_user_id),
            shared_interests: Some(shared.clone()),
            relationship: Some(rel_a),
        };
        let payload_b = ServerMessage::RoomMatched {
            room_id,
            role: Role::Answerer,
            peer_country: Some(a_meta.preferences.country.clone()),
            peer_email: a_meta.email.clone(),
            peer_user_id: Some(a_user_id),
            shared_interests: Some(shared),
            relationship: Some(rel_b),
        };
        for s in &a_sockets {
            self.send(*s, &payload_a);
        }
        for s in &b_sockets {
            self.send(*s, &payload_b);
        }

        let st = self.state.lock().await;
        self.broadcast_stats(&st);
        true
    }

    /// Resolves who a report or block is aimed at.
    ///
    /// A requested id is honoured only when it really is someone the caller
    /// shares a room with, so a client cannot report or block an arbitrary
    /// account. With no request, the single other participant is used.
    pub async fn resolve_target_user(
        &self,
        socket: SocketId,
        requested: Option<i64>,
    ) -> Option<i64> {
        let st = self.state.lock().await;
        let partner_id = st.rooms_by_socket.get(&socket).and_then(|room| {
            if room.a == socket {
                room.b_user_id
            } else if room.b == socket {
                room.a_user_id
            } else {
                None
            }
        });
        let group_user_ids: Vec<i64> = st
            .group_room_of_socket
            .get(&socket)
            .and_then(|id| st.group_rooms.get(id))
            .map(|g| {
                g.participants
                    .iter()
                    .filter(|p| p.socket != socket)
                    .filter_map(|p| p.user_id.filter(|id| *id != 0))
                    .collect()
            })
            .unwrap_or_default();

        match requested.filter(|id| *id != 0) {
            Some(req) => {
                if Some(req) == partner_id || group_user_ids.contains(&req) {
                    Some(req)
                } else {
                    None
                }
            }
            None => partner_id.or_else(|| {
                (group_user_ids.len() == 1).then(|| group_user_ids[0])
            }),
        }
    }

    /// Relays a WebRTC signal. In a group room it routes by `peer_id` first
    /// (unique even when several guests share `user_id` 0), then `user_id`,
    /// then broadcasts to the rest of the mesh.
    pub async fn relay_signal(
        &self,
        socket: SocketId,
        payload: crate::proto::SignalPayload,
        target_user_id: Option<i64>,
        target_peer_id: Option<i64>,
    ) {
        let st = self.state.lock().await;

        if let Some(group) = st
            .group_room_of_socket
            .get(&socket)
            .and_then(|id| st.group_rooms.get(id))
        {
            let sender = group.participant(socket);
            let sender_user_id = sender
                .and_then(|p| p.user_id)
                .or_else(|| self.hub.user_of(socket))
                .unwrap_or(0);
            let sender_peer_id = sender.and_then(|p| p.peer_id);

            let targets: Vec<SocketId> = if let Some(peer_id) = target_peer_id {
                group
                    .participants
                    .iter()
                    .filter(|p| p.peer_id == Some(peer_id) && p.socket != socket)
                    .map(|p| p.socket)
                    .take(1)
                    .collect()
            } else if let Some(user_id) = target_user_id {
                group
                    .participants
                    .iter()
                    .filter(|p| p.user_id == Some(user_id) && p.socket != socket)
                    .map(|p| p.socket)
                    .take(1)
                    .collect()
            } else {
                group
                    .participants
                    .iter()
                    .filter(|p| p.socket != socket)
                    .map(|p| p.socket)
                    .collect()
            };

            for target in &targets {
                self.send(
                    *target,
                    &ServerMessage::Signal {
                        payload: payload.clone(),
                        target_user_id: Some(sender_user_id),
                        from_peer_id: sender_peer_id,
                    },
                );
            }
            if !targets.is_empty() {
                inc("signals_relayed", 1);
            }
            return;
        }

        if let Some(partner) = st.partners.get(&socket).copied() {
            self.send(
                partner,
                &ServerMessage::Signal {
                    payload,
                    target_user_id: None,
                    from_peer_id: None,
                },
            );
            inc("signals_relayed", 1);
        }
    }

    /// Relays chat to the 1:1 partner, or to the rest of a group room.
    /// Returns the partner's user id when the message went to a 1:1 partner,
    /// so the caller can persist it if the two have a relationship.
    pub async fn relay_chat(&self, socket: SocketId, text: &str, time: &str) -> Option<i64> {
        let st = self.state.lock().await;
        let payload = crate::proto::ChatPayload {
            text: text.to_string(),
            time: time.to_string(),
        };

        if let Some(partner) = st.partners.get(&socket).copied() {
            self.send(
                partner,
                &ServerMessage::Chat {
                    payload: payload.clone(),
                },
            );
            inc("chats_relayed", 1);
            return st.rooms_by_socket.get(&socket).and_then(|room| {
                if room.a == socket {
                    room.b_user_id
                } else {
                    room.a_user_id
                }
            });
        }

        if let Some(group) = st
            .group_room_of_socket
            .get(&socket)
            .and_then(|id| st.group_rooms.get(id))
        {
            let targets: Vec<SocketId> = group
                .participants
                .iter()
                .filter(|p| p.socket != socket)
                .map(|p| p.socket)
                .collect();
            for target in targets {
                self.send(
                    target,
                    &ServerMessage::Chat {
                        payload: payload.clone(),
                    },
                );
            }
            inc("chats_relayed", 1);
        }
        None
    }

    /// Sockets of every other participant in the caller's group room.
    pub async fn group_peers_of(&self, socket: SocketId) -> Vec<SocketId> {
        let st = self.state.lock().await;
        st.group_room_of_socket
            .get(&socket)
            .and_then(|id| st.group_rooms.get(id))
            .map(|g| {
                g.participants
                    .iter()
                    .filter(|p| p.socket != socket)
                    .map(|p| p.socket)
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn is_group_participant(&self, room_id: &str, socket: SocketId) -> bool {
        self.state
            .lock()
            .await
            .group_rooms
            .get(room_id)
            .is_some_and(|g| g.participant(socket).is_some())
    }

    pub async fn group_host_socket(&self, room_id: &str) -> Option<SocketId> {
        self.state
            .lock()
            .await
            .group_rooms
            .get(room_id)
            .map(|g| g.host_socket)
    }

    pub async fn group_participant_count(&self, room_id: &str) -> usize {
        self.state
            .lock()
            .await
            .group_rooms
            .get(room_id)
            .map(|g| g.participants.len())
            .unwrap_or(0)
    }
}

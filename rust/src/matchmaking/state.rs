//! Matchmaking state. Port of `server/matchmaking/state.ts` and `types.ts`.
//!
//! Two translation decisions worth knowing:
//!
//! * The Node version keys its maps by socket *object identity*. Here every
//!   socket carries a server-assigned `SocketId` and the maps key on that.
//!
//! * Node holds `waitingGroups` as an array of references that alias the same
//!   objects as `groupRoomsById`. Rust has no such aliasing, so rooms live in
//!   one owning map keyed by room id and the queue holds ids in arrival order.

use std::collections::{HashMap, HashSet};

use crate::matchmaking::SocketId;
use crate::proto::{GroupVisibility, MatchPreferences, MatchScope};

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn recent_cooldown_ms() -> u64 {
    std::env::var("REMATCH_COOLDOWN_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10 * 60_000)
}

#[derive(Debug, Clone)]
pub struct QueuePeer {
    pub socket: SocketId,
    pub preferences: MatchPreferences,
    pub user_id: Option<i64>,
    pub email: Option<String>,
    pub session_key: String,
    pub joined_at: u64,
    pub last_beat: u64,
}

#[derive(Debug, Clone)]
pub struct Room {
    pub id: String,
    pub a: SocketId,
    pub b: SocketId,
    pub a_user_id: Option<i64>,
    pub b_user_id: Option<i64>,
    pub created_at: u64,
}

#[derive(Debug, Clone)]
pub struct GroupParticipant {
    pub socket: SocketId,
    pub user_id: Option<i64>,
    pub email: Option<String>,
    pub preferences: MatchPreferences,
    pub session_key: String,
    /// Assigned when the room becomes a live match; keys the WebRTC mesh tile.
    pub peer_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct GroupRoom {
    pub id: String,
    pub host_socket: SocketId,
    pub host_user_id: Option<i64>,
    pub host_email: Option<String>,
    pub visibility: GroupVisibility,
    pub scope: MatchScope,
    pub preferences: MatchPreferences,
    /// Insertion-ordered, mirroring JS `Map` iteration — the admin handover and
    /// peer-id assignment both depend on that order.
    pub participants: Vec<GroupParticipant>,
    pub created_at: u64,
    pub in_queue: bool,
    /// True once this room is a live match. Leaves then degrade gracefully
    /// instead of dissolving the room.
    pub matched: bool,
    /// True while the room is a live match between its own members and is still
    /// queued looking for an opposing side.
    pub searching: bool,
}

impl GroupRoom {
    pub fn participant(&self, socket: SocketId) -> Option<&GroupParticipant> {
        self.participants.iter().find(|p| p.socket == socket)
    }
    pub fn remove_participant(&mut self, socket: SocketId) -> Option<GroupParticipant> {
        let idx = self.participants.iter().position(|p| p.socket == socket)?;
        Some(self.participants.remove(idx))
    }
    pub fn upsert_participant(&mut self, p: GroupParticipant) {
        match self.participants.iter_mut().find(|x| x.socket == p.socket) {
            Some(slot) => *slot = p,
            None => self.participants.push(p),
        }
    }
}

#[derive(Default)]
pub struct EngineState {
    pub waiting_peers: Vec<QueuePeer>,
    /// Room ids in arrival order.
    pub waiting_groups: Vec<String>,
    pub group_rooms: HashMap<String, GroupRoom>,
    pub group_room_of_socket: HashMap<SocketId, String>,

    pub partners: HashMap<SocketId, SocketId>,
    pub rooms_by_socket: HashMap<SocketId, Room>,
    pub peer_meta: HashMap<SocketId, QueuePeer>,

    pub blocked_pairs: HashSet<String>,
    /// pair key -> expiry timestamp in ms.
    pub recent_pairs: HashMap<String, u64>,

    room_seq: u64,
    group_room_seq: u64,
}

impl EngineState {
    pub fn new_room_id(&mut self) -> String {
        self.room_seq += 1;
        format!("room_{}_{}", radix36(now_ms()), self.room_seq)
    }

    pub fn new_group_room_id(&mut self) -> String {
        self.group_room_seq += 1;
        format!("groom_{}_{}", radix36(now_ms()), self.group_room_seq)
    }

    pub fn queue_stats(&self) -> super::QueueStats {
        let group_participants: i64 = self
            .waiting_groups
            .iter()
            .filter_map(|id| self.group_rooms.get(id))
            .map(|g| g.participants.len() as i64)
            .sum();
        let waiting = self.waiting_peers.len() as i64 + group_participants;
        super::QueueStats {
            waiting,
            online: self.partners.len() as i64 + waiting,
        }
    }

    pub fn dequeue_group(&mut self, room_id: &str) {
        self.waiting_groups.retain(|id| id != room_id);
        if let Some(group) = self.group_rooms.get_mut(room_id) {
            group.in_queue = false;
        }
    }
}

/// `Date.now().toString(36)` — room ids are compared as opaque strings by the
/// client, but keeping the format identical avoids surprises in logs and tests.
fn radix36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Ordered pair key, so `(a,b)` and `(b,a)` collide deliberately.
///
/// Careful: the Node version compares with `<` on mixed types. For numbers it
/// compares numerically; this reproduces that for the numeric key spaces and
/// uses string ordering for session keys, matching each call site.
pub fn pair_key_users(prefix: &str, a: i64, b: i64) -> String {
    if a < b {
        format!("{prefix}:{a}:{b}")
    } else {
        format!("{prefix}:{b}:{a}")
    }
}

pub fn pair_key_sessions(prefix: &str, a: &str, b: &str) -> String {
    if a < b {
        format!("{prefix}:{a}:{b}")
    } else {
        format!("{prefix}:{b}:{a}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radix36_matches_javascript_tostring_36() {
        assert_eq!(radix36(0), "0");
        assert_eq!(radix36(35), "z");
        assert_eq!(radix36(36), "10");
        // Date.now()-sized value, verified against node:
        //   node -e "console.log((1786089116660).toString(36))"
        assert_eq!(radix36(1_786_089_116_660), "msincelw");
    }

    #[test]
    fn pair_keys_are_order_independent() {
        assert_eq!(pair_key_users("", 1, 2), pair_key_users("", 2, 1));
        assert_eq!(pair_key_sessions("s", "a", "b"), pair_key_sessions("s", "b", "a"));
        assert_ne!(pair_key_users("", 1, 2), pair_key_users("", 1, 3));
    }

    #[test]
    fn room_ids_are_unique_within_a_process() {
        let mut st = EngineState::default();
        let a = st.new_room_id();
        let b = st.new_room_id();
        assert_ne!(a, b);
        assert!(a.starts_with("room_"));
        assert!(st.new_group_room_id().starts_with("groom_"));
    }
}

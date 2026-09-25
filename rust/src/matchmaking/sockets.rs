//! Registry of live WebSocket connections, keyed by user.
//!
//! Port of `server/matchmaking/sockets.ts`. A user may hold several sockets
//! (multiple tabs), so lookups return all of them and "offline" means the last
//! one closed.
//!
//! Each socket owns a bounded sender feeding its write task; handlers push
//! frames into it rather than touching the socket directly, which keeps sending
//! non-blocking and lets any module notify a user without holding a lock on the
//! connection itself.
//!
//! Backpressure: sends use `try_send` and never block or grow memory without
//! bound. A socket whose outbox is full is a wedged/slow consumer, so it is
//! disconnected instead of buffered further (see `SOCKET_OUTGOING_CAPACITY`).
//! No server-to-client message type is dropped or coalesced: every frame type
//! (match lifecycle, signals, chat, presence, stats, errors) forms one ordered
//! stream, and silently skipping even a `stats` update while later frames flow
//! would desynchronize clients. Disconnecting forces a clean resync via
//! reconnect. If a high-frequency loss-tolerant frame (e.g. quality pings) is
//! ever added server-to-client, it could take a separate coalescing path, but
//! none exists today: stats/presence are event-driven and infrequent.
//!
//! Per-socket buffer audit: the outbox channel below is the only queue tied to
//! a socket. The registry maps hold one entry per live socket (removed on
//! disconnect); `route.rs` processes inbound frames serially with no queue and
//! holds no sender clone, so disconnecting here closes the channel and the
//! write task drains at most `SOCKET_OUTGOING_CAPACITY` frames before the
//! socket closes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::Sender;

use crate::proto::ServerMessage;

/// Maximum queued outbound frames per socket.
///
/// Rationale: legitimate bursts are small (a match fan-out is a handful of
/// frames: match + stats + presence), so 64 absorbs bursts and slow readers
/// while capping per-socket memory at 64 frames instead of growing without
/// bound when a client stops reading. A peer that falls 64 frames behind is
/// wedged; disconnecting it (so it reconnects fresh) is the correct recovery.
pub const SOCKET_OUTGOING_CAPACITY: usize = 64;

/// Server-assigned connection id, unique for the lifetime of the process.
pub type SocketId = u64;

#[derive(Clone)]
pub struct SocketHandle {
    pub id: SocketId,
    pub tx: Sender<String>,
}

#[derive(Default)]
struct Registry {
    /// Every live socket, including those of unauthenticated visitors.
    sockets: HashMap<SocketId, SocketHandle>,
    /// Authenticated sockets grouped by user.
    by_user: HashMap<i64, Vec<SocketId>>,
    /// Reverse lookup so a closing socket can be removed without a scan.
    user_of: HashMap<SocketId, i64>,
}

pub struct Hub {
    inner: RwLock<Registry>,
    next_id: AtomicU64,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(Registry::default()),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn connect(&self, tx: Sender<String>) -> SocketHandle {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let handle = SocketHandle { id, tx };
        self.inner
            .write()
            .expect("hub lock")
            .sockets
            .insert(id, handle.clone());
        handle
    }

    /// Binds a socket to a user once it authenticates. Re-registering the same
    /// socket is a no-op rather than a duplicate entry.
    pub fn register_user(&self, socket_id: SocketId, user_id: i64) {
        let mut reg = self.inner.write().expect("hub lock");
        if reg.user_of.get(&socket_id) == Some(&user_id) {
            return;
        }
        reg.user_of.insert(socket_id, user_id);
        let list = reg.by_user.entry(user_id).or_default();
        if !list.contains(&socket_id) {
            list.push(socket_id);
        }
    }

    /// Full teardown for a closing socket. Returns the user it belonged to, so
    /// the caller can announce presence changes.
    pub fn disconnect(&self, socket_id: SocketId) -> Option<i64> {
        let mut reg = self.inner.write().expect("hub lock");
        reg.sockets.remove(&socket_id);
        let user_id = reg.user_of.remove(&socket_id);
        if let Some(user_id) = user_id {
            if let Some(list) = reg.by_user.get_mut(&user_id) {
                list.retain(|id| *id != socket_id);
                if list.is_empty() {
                    reg.by_user.remove(&user_id);
                }
            }
        }
        user_id
    }

    pub fn socket_by_id(&self, socket_id: SocketId) -> Option<SocketHandle> {
        self.inner
            .read()
            .expect("hub lock")
            .sockets
            .get(&socket_id)
            .cloned()
    }

    pub fn user_of(&self, socket_id: SocketId) -> Option<i64> {
        self.inner.read().expect("hub lock").user_of.get(&socket_id).copied()
    }

    pub fn is_online(&self, user_id: i64) -> bool {
        self.inner
            .read()
            .expect("hub lock")
            .by_user
            .get(&user_id)
            .is_some_and(|list| !list.is_empty())
    }

    pub fn sockets_for_user(&self, user_id: i64) -> Vec<SocketHandle> {
        let reg = self.inner.read().expect("hub lock");
        reg.by_user
            .get(&user_id)
            .map(|ids| ids.iter().filter_map(|id| reg.sockets.get(id).cloned()).collect())
            .unwrap_or_default()
    }

    /// Every live socket, for broadcasts (stats, drain notices).
    pub fn all_sockets(&self) -> Vec<SocketHandle> {
        self.inner
            .read()
            .expect("hub lock")
            .sockets
            .values()
            .cloned()
            .collect()
    }

    pub fn send(&self, handle: &SocketHandle, message: &ServerMessage) {
        if let Ok(text) = serde_json::to_string(message) {
            self.push(handle, text);
        }
    }

    /// Fan out to every socket the user has open. Silently does nothing when
    /// they are offline, which is what the notification sites expect. A slow
    /// socket is disconnected without affecting the user's other sockets.
    pub fn send_to_user(&self, user_id: i64, message: &ServerMessage) {
        let Ok(text) = serde_json::to_string(message) else {
            return;
        };
        for handle in self.sockets_for_user(user_id) {
            self.push(&handle, text.clone());
        }
    }

    pub fn broadcast(&self, message: &ServerMessage) {
        let Ok(text) = serde_json::to_string(message) else {
            return;
        };
        for handle in self.all_sockets() {
            self.push(&handle, text.clone());
        }
    }

    /// Queues one frame without blocking. A full outbox means the peer is too
    /// slow, so the socket is disconnected: callers hold only transient handle
    /// clones and `route.rs` holds none, so dropping the registry entry closes
    /// the channel and the write task finishes the socket.
    fn push(&self, handle: &SocketHandle, text: String) {
        match handle.tx.try_send(text) {
            Ok(()) => {}
            // A closed receiver just means the socket is gone; its teardown
            // will clean up the registry.
            Err(TrySendError::Closed(_)) => {}
            Err(TrySendError::Full(_)) => {
                self.disconnect(handle.id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::{channel, Receiver};

    fn hub_with_socket(hub: &Hub) -> (SocketHandle, Receiver<String>) {
        let (tx, rx) = channel(SOCKET_OUTGOING_CAPACITY);
        (hub.connect(tx), rx)
    }

    #[test]
    fn a_user_can_hold_several_sockets_and_goes_offline_with_the_last() {
        let hub = Hub::new();
        let (a, _ra) = hub_with_socket(&hub);
        let (b, _rb) = hub_with_socket(&hub);
        hub.register_user(a.id, 7);
        hub.register_user(b.id, 7);

        assert_eq!(hub.sockets_for_user(7).len(), 2);
        assert!(hub.is_online(7));

        assert_eq!(hub.disconnect(a.id), Some(7));
        assert!(hub.is_online(7), "still one tab open");
        assert_eq!(hub.disconnect(b.id), Some(7));
        assert!(!hub.is_online(7), "last socket closed");
    }

    #[test]
    fn registering_the_same_socket_twice_does_not_duplicate_it() {
        let hub = Hub::new();
        let (a, _ra) = hub_with_socket(&hub);
        hub.register_user(a.id, 7);
        hub.register_user(a.id, 7);
        assert_eq!(hub.sockets_for_user(7).len(), 1);
    }

    #[test]
    fn sending_to_an_offline_user_is_a_no_op() {
        let hub = Hub::new();
        hub.send_to_user(999, &ServerMessage::ReportAck);
    }

    #[tokio::test]
    async fn messages_reach_every_socket_of_the_user() {
        let hub = Hub::new();
        let (a, mut ra) = hub_with_socket(&hub);
        let (b, mut rb) = hub_with_socket(&hub);
        hub.register_user(a.id, 7);
        hub.register_user(b.id, 7);

        hub.send_to_user(7, &ServerMessage::ReportAck);
        assert_eq!(ra.recv().await.unwrap(), r#"{"type":"report:ack"}"#);
        assert_eq!(rb.recv().await.unwrap(), r#"{"type":"report:ack"}"#);
    }

    #[test]
    fn an_unauthenticated_socket_disconnects_without_a_user() {
        let hub = Hub::new();
        let (a, _ra) = hub_with_socket(&hub);
        assert_eq!(hub.user_of(a.id), None);
        assert_eq!(hub.disconnect(a.id), None);
    }

    /// A socket that keeps up stays connected and sees its frames in order,
    /// even when the outbox fills exactly to capacity.
    #[tokio::test]
    async fn a_consumer_within_capacity_stays_connected() {
        let hub = Hub::new();
        let (a, mut ra) = hub_with_socket(&hub);
        for _ in 0..SOCKET_OUTGOING_CAPACITY {
            hub.send(&a, &ServerMessage::ReportAck);
        }
        assert!(
            hub.socket_by_id(a.id).is_some(),
            "a full-but-not-overflowing outbox must not disconnect"
        );
        for _ in 0..SOCKET_OUTGOING_CAPACITY {
            assert_eq!(ra.recv().await.unwrap(), r#"{"type":"report:ack"}"#);
        }
        assert!(hub.socket_by_id(a.id).is_some());
    }

    /// A client that stops reading must not grow server memory without bound:
    /// the outbox holds at most `SOCKET_OUTGOING_CAPACITY` frames, the next
    /// send disconnects the socket, and the channel closes so the write task
    /// drains the backlog and finishes the socket.
    #[tokio::test]
    async fn a_slow_consumer_is_disconnected_once_its_outbox_overflows() {
        let hub = Hub::new();
        let (tx, mut rx) = channel::<String>(SOCKET_OUTGOING_CAPACITY);
        // No sender clone is retained here, mirroring route.rs: the registry
        // holds the only one, so disconnecting closes the channel.
        let id = hub.connect(tx).id;

        for i in 0..=(SOCKET_OUTGOING_CAPACITY + 10) {
            let Some(handle) = hub.socket_by_id(id) else {
                assert!(
                    i > SOCKET_OUTGOING_CAPACITY,
                    "disconnected early at send {i} of capacity {SOCKET_OUTGOING_CAPACITY}"
                );
                break;
            };
            hub.send(&handle, &ServerMessage::ReportAck);
        }
        assert!(
            hub.socket_by_id(id).is_none(),
            "slow socket must be disconnected on overflow"
        );

        let mut buffered = 0;
        while rx.try_recv().is_ok() {
            buffered += 1;
        }
        assert_eq!(
            buffered, SOCKET_OUTGOING_CAPACITY,
            "outbox must be bounded no matter how much was pushed"
        );
        assert!(
            rx.recv().await.is_none(),
            "channel must close so the write task ends"
        );
    }

    #[tokio::test]
    async fn send_to_user_disconnects_only_the_slow_socket() {
        let hub = Hub::new();
        let (slow, _slow_rx) = hub_with_socket(&hub);
        let (fast, mut fast_rx) = hub_with_socket(&hub);
        hub.register_user(slow.id, 7);
        hub.register_user(fast.id, 7);

        for _ in 0..=(SOCKET_OUTGOING_CAPACITY + 8) {
            hub.send_to_user(7, &ServerMessage::ReportAck);
            // The healthy tab keeps draining, so it must never overflow.
            fast_rx.recv().await.unwrap();
        }

        assert!(
            hub.socket_by_id(slow.id).is_none(),
            "slow socket must be disconnected"
        );
        assert!(
            hub.socket_by_id(fast.id).is_some(),
            "healthy socket must stay connected"
        );
        assert!(hub.is_online(7));
        assert_eq!(hub.sockets_for_user(7).len(), 1);
    }

    #[tokio::test]
    async fn broadcast_disconnects_slow_sockets_and_keeps_healthy_ones() {
        let hub = Hub::new();
        let (slow, _slow_rx) = hub_with_socket(&hub);
        let (fast, mut fast_rx) = hub_with_socket(&hub);

        for _ in 0..=(SOCKET_OUTGOING_CAPACITY + 8) {
            hub.broadcast(&ServerMessage::ReportAck);
            fast_rx.recv().await.unwrap();
        }

        assert!(
            hub.socket_by_id(slow.id).is_none(),
            "slow socket must be disconnected"
        );
        assert!(
            hub.socket_by_id(fast.id).is_some(),
            "healthy socket must stay connected"
        );
        assert_eq!(hub.all_sockets().len(), 1);
    }
}

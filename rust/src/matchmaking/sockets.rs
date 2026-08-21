//! Registry of live WebSocket connections, keyed by user.
//!
//! Port of `server/matchmaking/sockets.ts`. A user may hold several sockets
//! (multiple tabs), so lookups return all of them and "offline" means the last
//! one closed.
//!
//! Each socket owns an unbounded sender feeding its write task; handlers push
//! frames into it rather than touching the socket directly, which keeps sending
//! non-blocking and lets any module notify a user without holding a lock on the
//! connection itself.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use tokio::sync::mpsc::UnboundedSender;

use crate::proto::ServerMessage;

/// Server-assigned connection id, unique for the lifetime of the process.
pub type SocketId = u64;

#[derive(Clone)]
pub struct SocketHandle {
    pub id: SocketId,
    pub tx: UnboundedSender<String>,
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

    pub fn connect(&self, tx: UnboundedSender<String>) -> SocketHandle {
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
            // A closed receiver just means the socket is gone; its teardown
            // will clean up the registry.
            let _ = handle.tx.send(text);
        }
    }

    /// Fan out to every socket the user has open. Silently does nothing when
    /// they are offline, which is what the notification sites expect.
    pub fn send_to_user(&self, user_id: i64, message: &ServerMessage) {
        let Ok(text) = serde_json::to_string(message) else {
            return;
        };
        for handle in self.sockets_for_user(user_id) {
            let _ = handle.tx.send(text.clone());
        }
    }

    pub fn broadcast(&self, message: &ServerMessage) {
        let Ok(text) = serde_json::to_string(message) else {
            return;
        };
        for handle in self.all_sockets() {
            let _ = handle.tx.send(text.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    fn hub_with_socket(hub: &Hub) -> (SocketHandle, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = unbounded_channel();
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
}

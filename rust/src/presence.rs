//! Friend presence over the existing WebSocket. Port of `server/presence.ts`.
//!
//! "Online" means the user has at least one authenticated socket open. On
//! connect we tell the user which friends are already online and tell those
//! friends about the newcomer; on disconnect (last socket gone) we do the
//! reverse.

use libsql::params;

use crate::db::Db;
use crate::matchmaking::{Hub, SocketId};
use crate::proto::ServerMessage;

async fn accepted_friend_ids(db: &Db, user_id: i64) -> Vec<i64> {
    let Ok(mut rows) = db
        .conn()
        .query(
            "SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END AS friend_id
             FROM friends
             WHERE status = 'accepted' AND (user_a_id = ? OR user_b_id = ?)",
            params![user_id, user_id, user_id],
        )
        .await
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    while let Ok(Some(row)) = rows.next().await {
        if let Ok(id) = row.get::<i64>(0) {
            if id != 0 {
                out.push(id);
            }
        }
    }
    out
}

/// Call right after a socket authenticates.
pub async fn announce_online(db: &Db, hub: &Hub, user_id: i64, socket: SocketId) {
    let friend_ids = accepted_friend_ids(db, user_id).await;
    if friend_ids.is_empty() {
        return;
    }
    let online: Vec<i64> = friend_ids
        .iter()
        .copied()
        .filter(|id| hub.is_online(*id))
        .collect();

    if let Some(handle) = hub.socket_by_id(socket) {
        hub.send(&handle, &ServerMessage::PresenceList { user_ids: online });
    }
    for id in friend_ids {
        hub.send_to_user(id, &ServerMessage::PresenceOnline { user_id });
    }
}

/// Call after a socket is removed; a no-op while other sockets of the user
/// remain open.
pub async fn announce_offline(db: &Db, hub: &Hub, user_id: i64) {
    if hub.is_online(user_id) {
        return;
    }
    for id in accepted_friend_ids(db, user_id).await {
        hub.send_to_user(id, &ServerMessage::PresenceOffline { user_id });
    }
}

//! Matchmaking engine. Port of `server/matchmaking/`.

pub mod core;
pub mod sockets;
pub mod state;

pub use core::Engine;
pub use sockets::{Hub, SocketId};

/// Queue counters reported by `/api/v1/health` and the admin overview.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueueStats {
    pub waiting: i64,
    pub online: i64,
}

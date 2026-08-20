//! Matchmaking engine.
//!
//! Phase 5 lands the queue, rooms and pairing logic ported from
//! `server/matchmaking/`. For now this exposes only the counters the health and
//! admin endpoints report, so those routes can be finished and verified without
//! waiting on the engine.

pub mod sockets;
pub mod state;

pub use sockets::{Hub, SocketHandle, SocketId};
pub use state::{queue_stats, QueueStats};

//! Shared matchmaking state.
//!
//! Port of `server/matchmaking/state.ts`. The Node version keeps this in
//! module-level `Map`s; the Rust version will keep it behind a lock in the same
//! process, preserving the single-instance ownership the design assumes.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueueStats {
    pub waiting: i64,
    pub online: i64,
}

/// `waiting` counts solo peers plus every participant of a waiting group;
/// `online` adds the peers already paired into rooms.
///
/// Phase 5 replaces the zeros with the real queues. Reporting zero is the
/// correct empty-server answer, so health and admin output stay well-formed in
/// the meantime.
pub fn queue_stats() -> QueueStats {
    QueueStats {
        waiting: 0,
        online: 0,
    }
}

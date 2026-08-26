//! Authentication primitives. Port of `server/auth.ts`.
//!
//! Everything here is constrained by data already on disk: password hashes,
//! session token hashes and their `salt:key` encoding must be interpreted
//! exactly as the Node implementation wrote them, or existing users silently
//! fail to log in. See `password::hash_password` for the specifics.

pub mod better_auth;
pub mod oauth;
pub mod password;
pub mod resolver;
pub mod session;

// Re-exported for the auth routes arriving in Phase 3.
#[allow(unused_imports)]
pub use password::{hash_password, hash_token, valid_credentials, verify_password};

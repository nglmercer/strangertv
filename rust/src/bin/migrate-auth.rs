//! Explicit Better Auth schema migration command.
//!
//! This binary is intentionally separate from the server so deployment can
//! apply auth DDL before starting new application instances.

#![allow(dead_code)]

#[path = "../auth/password.rs"]
pub mod password;
mod auth {
    pub use crate::password;
}
#[path = "../auth/better_auth.rs"]
mod better_auth;
#[path = "../config.rs"]
mod config;

use better_auth::BetterAuthState;
use config::Config;

#[tokio::main]
async fn main() {
    let config = Config::from_env();
    let state = match BetterAuthState::connect_from_env(&config).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("migrate-auth failed: {error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = state.apply_migrations().await {
        eprintln!("migrate-auth failed: {error}");
        std::process::exit(1);
    }
    println!("Better Auth schema migration applied successfully.");
}

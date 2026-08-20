//! Stranger-chat API server.
//!
//! Rust port of `server/index.ts` — see `docs/rust-migration-plan.md`. Phase 1
//! stands up the process skeleton and the wire contract; routes and the
//! matchmaking engine land in later phases.

// Each module lands a phase ahead of the handlers that call it, so items are
// legitimately unused until their route or engine arrives. Phase 7 (parity and
// hardening) removes this and treats what remains as genuinely dead.
#![allow(dead_code)]

mod age;
mod auth;
mod config;
mod db;
mod infra;
mod proto;
mod routes;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;

use crate::config::Config;
use crate::db::Db;

/// Everything a handler may need, cloned per request.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: Arc<Db>,
}

#[tokio::main]
async fn main() {
    let config = Arc::new(Config::from_env());
    infra::logger::init(&config.log_level);
    infra::metrics::init();

    let db = match Db::connect().await {
        Ok(db) => Arc::new(db),
        Err(err) => {
            log_error!("db.connect_failed", { "message": err.to_string() });
            std::process::exit(1);
        }
    };
    if let Err(err) = db.migrate().await {
        log_error!("db.migrate_failed", { "message": err.to_string() });
        std::process::exit(1);
    }
    log_info!("db.migrated", {
        "url": if db.url.starts_with("file:") { "local" } else { "remote" },
        "blocks": count_blocks(&db).await
    });

    let port = config.port;
    let state = AppState {
        config: Arc::clone(&config),
        db: Arc::clone(&db),
    };

    let app: Router = Router::new().merge(routes::health::router(state.clone()));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
            log_error!("server.port_in_use", {
                "port": port,
                "hint": format!(
                    "Port {port} is already taken (leftover dev server?). \
                     Free it with: npm run free-ports  (or: fuser -k {port}/tcp)"
                )
            });
            std::process::exit(1);
        }
        Err(err) => {
            log_error!("server.listen_error", { "message": err.to_string() });
            std::process::exit(1);
        }
    };

    log_info!("server.listen", {
        "port": port,
        "static": config.static_dir,
        "env": config.node_env
    });

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap_or_else(|err| {
            log_error!("server.serve_error", { "message": err.to_string() });
            std::process::exit(1);
        });
}

/// Reported at startup like the Node server. Hydrating these into the
/// in-memory blocked-pair set arrives with matchmaking in Phase 5.
async fn count_blocks(db: &Db) -> i64 {
    let Ok(mut rows) = db.conn().query("SELECT COUNT(*) FROM blocks", ()).await else {
        return 0;
    };
    match rows.next().await {
        Ok(Some(row)) => row.get(0).unwrap_or(0),
        _ => 0,
    }
}

/// SIGTERM/SIGINT. The drain broadcast to live sockets arrives with the
/// WebSocket layer in Phase 6.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => log_info!("server.shutdown", { "signal": "SIGINT" }),
        _ = terminate => log_info!("server.shutdown", { "signal": "SIGTERM" }),
    }
}

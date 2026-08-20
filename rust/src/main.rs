//! Stranger-chat API server.
//!
//! Rust port of `server/index.ts` — see `docs/rust-migration-plan.md`. Phase 1
//! stands up the process skeleton and the wire contract; routes and the
//! matchmaking engine land in later phases.

mod config;
mod infra;
mod proto;
mod routes;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;

use crate::config::Config;

/// Everything a handler may need, cloned per request.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
}

#[tokio::main]
async fn main() {
    let config = Arc::new(Config::from_env());
    infra::logger::init(&config.log_level);

    let port = config.port;
    let state = AppState {
        config: Arc::clone(&config),
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

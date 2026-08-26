//! Stranger-chat API server.
//!
//! Phases 1–3 cover the process skeleton, the wire contract, the database and
//! auth layer, and the HTTP routes. Matchmaking and the WebSocket protocol
//! arrive in phases 5 and 6.

mod age;
mod alerts;
mod auth;
mod config;
mod constants;
mod db;
mod domain;
mod email;
mod error;
mod infra;
mod matchmaking;
mod openapi;
mod presence;
mod proto;
mod routes;
mod static_files;
mod turn;
mod ws;

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::extract::Request;
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::config::Config;
use crate::db::Db;
use crate::static_files::StaticHandler;

const API_PREFIX: &str = "/api/v1";
const WS_PATH: &str = "/ws";

/// Everything a handler may need, cloned per request.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: Arc<Db>,
    pub better_auth: Arc<auth::better_auth::BetterAuthState>,
    /// `None` when Google sign-in is not configured for this deployment.
    pub google_oauth: Option<Arc<auth::oauth::GoogleOAuth>>,
    pub hub: Arc<matchmaking::Hub>,
    pub engine: Arc<matchmaking::Engine>,
    draining: Arc<AtomicBool>,
    db_ok: Arc<AtomicBool>,
    r#static: Arc<StaticHandler>,
}

impl AppState {
    pub fn is_draining(&self) -> bool {
        self.draining.load(Ordering::Relaxed)
    }
    pub fn set_draining(&self, value: bool) {
        self.draining.store(value, Ordering::Relaxed);
    }
    pub fn db_ok(&self) -> bool {
        self.db_ok.load(Ordering::Relaxed)
    }
    pub fn set_db_ok(&self, value: bool) {
        self.db_ok.store(value, Ordering::Relaxed);
    }
}

#[tokio::main]
async fn main() {
    // `--healthcheck` probes the local liveness endpoint and exits 0/1. Having
    // it in the binary keeps the runtime image free of curl/wget, which a
    // scratch or distroless base would not provide.
    if std::env::args().any(|a| a == "--healthcheck") {
        std::process::exit(healthcheck().await);
    }

    let config = Arc::new(Config::from_env());
    infra::logger::init(&config.log_level);
    infra::metrics::init();
    infra::rate_limit::spawn_cleanup();

    // Sanitized startup config for debugging deployments. DB "local"/"remote"
    // kind and whether it came from a dev default are logged at connect/migrate;
    // never log TURSO_AUTH_TOKEN.
    log_info!("startup.config", {
        "env": config.node_env,
        "port": config.port
    });

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

    let better_auth = match auth::better_auth::BetterAuthState::connect(&config, &db.url).await {
        Ok(state) => Arc::new(state),
        Err(err) => {
            log_error!("better_auth.connect_failed", { "message": err.to_string() });
            std::process::exit(1);
        }
    };
    log_info!("better_auth.ready", {
        "schemaMigration": "explicit",
        "sessionDays": 14
    });

    // Google sign-in is optional. A misconfigured redirect URI is fatal, but
    // an absent client id simply leaves the provider off.
    let google_oauth = match auth::oauth::GoogleOAuth::from_env(&config, &better_auth) {
        Ok(provider) => provider.map(Arc::new),
        Err(err) => {
            log_error!("oauth.google_config_failed", { "message": err.to_string() });
            std::process::exit(1);
        }
    };
    log_info!("oauth.google", { "configured": google_oauth.is_some() });
    // Google sign-in has no legacy fallback: every step needs the Better Auth
    // tables, including the key/value store that holds the OAuth state. Say so
    // at boot rather than letting the first sign-in attempt 500.
    if google_oauth.is_some() && !better_auth.schema_ready().await {
        log_error!("oauth.google_schema_missing", {
            "hint": "Google sign-in needs the Better Auth schema. Run the migrate-auth binary against this database."
        });
    }

    let hub = Arc::new(matchmaking::Hub::new());

    let dist_dir = if config.static_dir.is_empty() {
        "dist".to_string()
    } else {
        config.static_dir.clone()
    };
    let state = AppState {
        config: Arc::clone(&config),
        db: Arc::clone(&db),
        better_auth,
        google_oauth,
        hub: Arc::clone(&hub),
        engine: Arc::new(matchmaking::Engine::new(Arc::clone(&hub), Arc::clone(&db))),
        draining: Arc::new(AtomicBool::new(false)),
        db_ok: Arc::new(AtomicBool::new(true)),
        r#static: Arc::new(StaticHandler::new(&dist_dir, Some("dist"))),
    };

    let app = build_router(state.clone());

    let port = config.port;
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
        "static": dist_dir,
        "env": config.node_env
    });

    let shutdown_state = state.clone();
    // `into_make_service_with_connect_info` so the WebSocket upgrade can read
    // the peer address when no proxy header is present.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal(shutdown_state))
    .await
    .unwrap_or_else(|err| {
        log_error!("server.serve_error", { "message": err.to_string() });
        std::process::exit(1);
    });
}

/// Middleware order mirrors the Hono chain: request id, security headers and
/// compression wrap everything; CORS applies to the API prefix.
///
/// `tower` layers run bottom-up, so the listing order here is the reverse of
/// the `app.use(...)` order in `server/index.ts`.
fn build_router(state: AppState) -> Router {
    let origins = state.config.cors_origins.clone();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _| {
            origin
                .to_str()
                .map(|o| origins.iter().any(|allowed| allowed == o))
                .unwrap_or(false)
        }))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        // `Allow-Headers: *` is invalid alongside `Allow-Credentials: true`
        // (tower-http rejects it at startup). Mirroring the request's
        // Access-Control-Request-Headers is what the Hono config effectively
        // did and is the spec-legal equivalent.
        .allow_headers(tower_http::cors::AllowHeaders::mirror_request());

    Router::new()
        .merge(routes::health::router(state.clone()))
        .merge(routes::auth::router(state.clone()))
        .merge(routes::misc::router(state.clone()))
        .merge(routes::social::router(state.clone()))
        .merge(routes::groups::router(state.clone()))
        .merge(ws::route::router(state.clone()))
        .merge(routes::admin::router(state.clone()))
        // The merged routers already carry their state, so this router is
        // `Router<()>`; the fallback captures what it needs instead.
        .fallback({
            let state = state.clone();
            move |req: Request| {
                let state = state.clone();
                async move { spa_fallback(state, req).await }
            }
        })
        .layer(cors)
        .layer(CompressionLayer::new())
        .layer(axum::middleware::from_fn(infra::security::security_headers))
        .layer(axum::middleware::from_fn(infra::request_id::request_id))
}

/// Production: serve the Vite build for SPA routes (including `/admin`).
/// API and WebSocket paths must 404 rather than fall back to `index.html`.
async fn spa_fallback(state: AppState, req: Request) -> Response {
    let path = req.uri().path().to_string();
    if path.starts_with(API_PREFIX) || path == WS_PATH {
        return StatusCode::NOT_FOUND.into_response();
    }
    match state.r#static.serve(&path).await {
        Some(res) => res,
        None => (
            StatusCode::NOT_FOUND,
            "Not found — run npm run build or use Vite dev server",
        )
            .into_response(),
    }
}

/// Exit code for the container HEALTHCHECK: 0 when the API answers, 1 otherwise.
async fn healthcheck() -> i32 {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8787".into());
    let url = format!("http://127.0.0.1:{port}/api/v1/health/live");
    match reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => 0,
        _ => 1,
    }
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
/// WebSocket layer in Phase 6; the readiness flag flips immediately so load
/// balancers stop sending new traffic.
async fn shutdown_signal(state: AppState) {
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

    let signal = tokio::select! {
        _ = ctrl_c => "SIGINT",
        _ = terminate => "SIGTERM",
    };

    // Flip readiness first so load balancers stop sending new traffic, then
    // tell live sockets to reconnect elsewhere, then give them the drain window
    // before the listener closes.
    state.set_draining(true);
    log_info!("server.draining", { "signal": signal, "drainMs": state.config.drain_ms });
    ws::route::broadcast_drain(&state).await;
    tokio::time::sleep(std::time::Duration::from_millis(state.config.drain_ms)).await;
    log_info!("server.shutdown", { "signal": signal });
}

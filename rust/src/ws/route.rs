//! WebSocket upgrade and per-connection task. Port of the `wss.on('connection')`
//! block in `server/index.ts`.
//!
//! Each connection splits into a read half (parsing client frames) and a write
//! half fed by an unbounded channel. Handlers push into that channel rather than
//! touching the socket, so a notification never blocks on a slow peer and any
//! module can reach a user without holding the connection.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use tokio::sync::mpsc::unbounded_channel;

use crate::auth::resolver::{resolve_authenticated_user, AuthenticatedUser};
use crate::infra::http::client_ip;
use crate::proto::ServerMessage;
use crate::ws::handlers::{handle_message, WsContext};
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new().route("/ws", any(upgrade)).with_state(state)
}

/// Browser cookies are automatically attached to a WebSocket upgrade, so the
/// handshake needs its own CSWSH boundary. HTTP CORS does not protect this
/// upgrade; compare the browser Origin to the same exact configured allowlist.
/// Clients without an Origin (for example native protocol clients) remain
/// supported and are authenticated by the normal handshake/protocol checks.
fn origin_is_allowed(headers: &HeaderMap, trusted_origins: &[String]) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    trusted_origins.iter().any(|trusted| trusted == origin)
}

// `WebSocketUpgrade` consumes the request, so it must be the LAST extractor.
async fn upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> Response {
    if state.is_draining() {
        return (StatusCode::SERVICE_UNAVAILABLE, "draining").into_response();
    }
    if !origin_is_allowed(&headers, &state.config.cors_origins) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    // Proxy headers first, then the peer address — `client_ip` only knows about
    // the former, and a direct connection has no `x-forwarded-for`.
    let mut ip = client_ip(&headers);
    if ip == "unknown" {
        ip = peer.ip().to_string();
    }
    let authenticated_user = match resolve_authenticated_user(&headers, &state).await {
        Ok(user) => user,
        Err(error) => {
            crate::log_error!("ws.auth_resolve_failed", { "message": error.to_string() });
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    ws.on_upgrade(move |socket| connection(state, socket, ip, headers, authenticated_user))
}

/// Opaque per-connection key used for rate limiting and guest report
/// attribution. Same construction as the Node version: a truncated hash of the
/// ip, the clock and a random value.
fn session_key(ip: &str) -> String {
    let nonce: u64 = rand::random();
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "{ip}:{}:{nonce}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    hex::encode(hasher.finalize())[..16].to_string()
}

async fn connection(
    state: AppState,
    socket: WebSocket,
    ip: String,
    auth_headers: HeaderMap,
    authenticated_user: Option<AuthenticatedUser>,
) {
    use futures_util::{SinkExt, StreamExt};

    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = unbounded_channel::<String>();
    let handle = state.hub.connect(tx);
    let socket_id = handle.id;

    if let Some(user) = &authenticated_user {
        state.hub.register_user(socket_id, user.user_id);
        crate::presence::announce_online(&state.db, &state.hub, user.user_id, socket_id).await;
    }

    crate::infra::metrics::inc("ws_connections", 1);

    // Write half: everything queued for this socket, in order.
    let writer = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let ctx = WsContext {
        socket: socket_id,
        ip: ip.clone(),
        session_key: session_key(&ip),
        auth_headers,
        authenticated_user,
    };

    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(text) => handle_message(&state, &ctx, &text).await,
            // Binary frames are not part of the protocol; ping/pong is handled
            // by the transport.
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Teardown: read the user before the registry forgets the socket, so
    // presence can be announced.
    let user_id = state.hub.user_of(socket_id);
    state.engine.full_remove(socket_id).await;
    state.hub.disconnect(socket_id);
    if let Some(user_id) = user_id {
        crate::presence::announce_offline(&state.db, &state.hub, user_id).await;
    }
    writer.abort();
}

/// Tells every live client the server is going away so they can reconnect to
/// another instance. The sockets are left open for the drain window rather than
/// closed immediately, matching the Node shutdown.
pub async fn broadcast_drain(state: &AppState) {
    state.hub.broadcast(&ServerMessage::ServerDraining {
        message: Some("Server is restarting. Please reconnect shortly.".into()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_origin_is_allowed_for_non_browser_clients() {
        assert!(origin_is_allowed(
            &HeaderMap::new(),
            &["https://app.example".into()]
        ));
    }

    #[test]
    fn origin_must_exactly_match_the_configured_allowlist() {
        let mut headers = HeaderMap::new();
        headers.insert(header::ORIGIN, "https://app.example".parse().unwrap());
        assert!(origin_is_allowed(&headers, &["https://app.example".into()]));
        assert!(!origin_is_allowed(
            &headers,
            &["https://attacker.example".into()]
        ));
    }
}

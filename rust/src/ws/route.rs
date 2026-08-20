//! WebSocket upgrade and per-connection task. Port of the `wss.on('connection')`
//! block in `server/index.ts`.
//!
//! Each connection splits into a read half (parsing client frames) and a write
//! half fed by an unbounded channel. Handlers push into that channel rather than
//! touching the socket, so a notification never blocks on a slow peer and any
//! module can reach a user without holding the connection.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use tokio::sync::mpsc::unbounded_channel;

use crate::infra::http::client_ip;
use crate::proto::ServerMessage;
use crate::ws::handlers::{handle_message, WsContext};
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new().route("/ws", any(upgrade)).with_state(state)
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
    // Proxy headers first, then the peer address — `client_ip` only knows about
    // the former, and a direct connection has no `x-forwarded-for`.
    let mut ip = client_ip(&headers);
    if ip == "unknown" {
        ip = peer.ip().to_string();
    }
    ws.on_upgrade(move |socket| connection(state, socket, ip))
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

async fn connection(state: AppState, socket: WebSocket, ip: String) {
    use futures_util::{SinkExt, StreamExt};

    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = unbounded_channel::<String>();
    let handle = state.hub.connect(tx);
    let socket_id = handle.id;

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

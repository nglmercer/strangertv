//! Request id propagation. Port of `server/requestId.ts`.

use axum::extract::Request;
use axum::http::{HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use rand::RngCore;

pub const X_REQUEST_ID: &str = "x-request-id";

/// Echoes a caller-supplied id (max 64 chars, as in the original) or mints one.
pub async fn request_id(req: Request, next: Next) -> Response {
    let incoming = req
        .headers()
        .get(X_REQUEST_ID)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty() && v.len() <= 64)
        .map(str::to_string);

    let id = incoming.unwrap_or_else(|| {
        let mut bytes = [0u8; 8];
        rand::thread_rng().fill_bytes(&mut bytes);
        hex::encode(bytes)
    });

    let mut res = next.run(req).await;
    if let Ok(value) = HeaderValue::from_str(&id) {
        res.headers_mut().insert(X_REQUEST_ID, value);
    }
    res
}

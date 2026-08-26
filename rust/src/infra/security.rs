//! Security headers and the admin gate. Port of `server/security.ts`.

use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

pub const X_ADMIN_KEY: &str = "x-admin-key";

/// Applied to every response. `tower` layers run inside-out, so this sets its
/// headers after the handler has produced a response, matching the Node
/// middleware that awaits `next()` before writing.
pub async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    h.insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    h.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(self), microphone=(self), geolocation=()"),
    );
    if std::env::var("NODE_ENV").as_deref() == Ok("production") {
        h.insert(
            "strict-transport-security",
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
        // Allow same-origin WS + media; tighten further behind a reverse proxy.
        // `lh3.googleusercontent.com` is where Google serves the avatars
        // stored on OAuth users; without it those images silently fail.
        h.insert(
            "content-security-policy",
            HeaderValue::from_static(
                "default-src 'self'; \
                 script-src 'self'; \
                 style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
                 font-src 'self' https://fonts.gstatic.com; \
                 img-src 'self' data: https://lh3.googleusercontent.com; \
                 connect-src 'self' ws: wss:; \
                 media-src 'self' blob:; \
                 frame-ancestors 'none'",
            ),
        );
    }
    res
}

/// True only when `ADMIN_KEY` is set AND the header matches it. An unset
/// `ADMIN_KEY` denies everyone rather than allowing everyone.
pub fn require_admin(headers: &HeaderMap) -> bool {
    let Ok(expected) = std::env::var("ADMIN_KEY") else {
        return false;
    };
    if expected.is_empty() {
        return false;
    }
    headers
        .get(X_ADMIN_KEY)
        .and_then(|v| v.to_str().ok())
        .map(|got| got == expected)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_denied_when_no_key_is_configured() {
        std::env::remove_var("ADMIN_KEY");
        let mut h = HeaderMap::new();
        h.insert(X_ADMIN_KEY, HeaderValue::from_static("anything"));
        assert!(!require_admin(&h), "unset ADMIN_KEY must not open the door");

        std::env::set_var("ADMIN_KEY", "");
        assert!(!require_admin(&h), "empty ADMIN_KEY must not open the door");
        std::env::remove_var("ADMIN_KEY");
    }
}

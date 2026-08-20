//! Request helpers. Port of `server/http.ts`.

use axum::http::HeaderMap;

const AUTHORIZATION: &str = "authorization";
const X_SESSION_TOKEN: &str = "x-session-token";
const X_FORWARDED_FOR: &str = "x-forwarded-for";
const X_REAL_IP: &str = "x-real-ip";
const BEARER_PREFIX: &str = "Bearer ";

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// Bearer token, falling back to the `x-session-token` header.
pub fn get_bearer(headers: &HeaderMap) -> Option<String> {
    if let Some(h) = header(headers, AUTHORIZATION) {
        if let Some(token) = h.strip_prefix(BEARER_PREFIX) {
            return Some(token.to_string());
        }
    }
    header(headers, X_SESSION_TOKEN).map(str::to_string)
}

/// Best-effort client IP from proxy headers, falling back to `unknown`.
///
/// Note this trusts `x-forwarded-for` unconditionally, exactly as the Node
/// version does — it is only ever used for rate-limit keys and report
/// attribution, and changing it here would change rate-limit behaviour.
pub fn client_ip(headers: &HeaderMap) -> String {
    if let Some(xff) = header(headers, X_FORWARDED_FOR) {
        if let Some(first) = xff.split(',').next() {
            let first = first.trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    header(headers, X_REAL_IP)
        .map(str::to_string)
        .unwrap_or_else(|| "unknown".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn bearer_wins_over_the_session_header() {
        let h = headers(&[("authorization", "Bearer abc"), ("x-session-token", "xyz")]);
        assert_eq!(get_bearer(&h).as_deref(), Some("abc"));
    }

    #[test]
    fn a_non_bearer_authorization_falls_through_to_the_session_header() {
        let h = headers(&[("authorization", "Basic zzz"), ("x-session-token", "xyz")]);
        assert_eq!(get_bearer(&h).as_deref(), Some("xyz"));
    }

    #[test]
    fn missing_credentials_are_none_not_empty_string() {
        assert_eq!(get_bearer(&HeaderMap::new()), None);
    }

    #[test]
    fn client_ip_takes_the_first_forwarded_hop() {
        let h = headers(&[("x-forwarded-for", "1.2.3.4, 5.6.7.8")]);
        assert_eq!(client_ip(&h), "1.2.3.4");
    }

    #[test]
    fn client_ip_falls_back_through_real_ip_to_unknown() {
        assert_eq!(client_ip(&headers(&[("x-real-ip", "9.9.9.9")])), "9.9.9.9");
        assert_eq!(client_ip(&HeaderMap::new()), "unknown");
    }
}

//! Request helpers. Port of `server/http.ts`.

use axum::http::HeaderMap;

const AUTHORIZATION: &str = "authorization";
const X_SESSION_TOKEN: &str = "x-session-token";
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
}

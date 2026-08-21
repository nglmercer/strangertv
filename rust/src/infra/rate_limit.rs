//! Fixed-window rate limiting. Port of `server/rateLimit.ts`.
//!
//! Deliberately in-process, like the original: buckets are per-instance, so a
//! horizontally scaled deployment limits per pod. Preserving that (rather than
//! quietly introducing shared state) keeps the port behaviour-for-behaviour.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

struct Bucket {
    count: u32,
    reset_at: u64,
}

fn buckets() -> &'static Mutex<HashMap<String, Bucket>> {
    static B: OnceLock<Mutex<HashMap<String, Bucket>>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy)]
pub struct RateLimitResult {
    pub ok: bool,
    pub limit: u32,
    pub remaining: u32,
    pub reset_at: u64,
}

pub fn rate_limit(key: &str, limit: u32, window_ms: u64) -> bool {
    rate_limit_info(key, limit, window_ms).ok
}

pub fn rate_limit_info(key: &str, limit: u32, window_ms: u64) -> RateLimitResult {
    let now = now_ms();
    let mut map = buckets().lock().expect("rate limit mutex");
    match map.get_mut(key) {
        Some(bucket) if now <= bucket.reset_at => {
            if bucket.count >= limit {
                RateLimitResult {
                    ok: false,
                    limit,
                    remaining: 0,
                    reset_at: bucket.reset_at,
                }
            } else {
                bucket.count += 1;
                RateLimitResult {
                    ok: true,
                    limit,
                    remaining: limit.saturating_sub(bucket.count),
                    reset_at: bucket.reset_at,
                }
            }
        }
        _ => {
            let reset_at = now + window_ms;
            map.insert(key.to_string(), Bucket { count: 1, reset_at });
            RateLimitResult {
                ok: true,
                limit,
                remaining: limit.saturating_sub(1),
                reset_at,
            }
        }
    }
}

/// `X-RateLimit-*`, with reset expressed in whole seconds like the original.
pub fn rate_limit_headers(info: &RateLimitResult) -> [(&'static str, String); 3] {
    [
        ("x-ratelimit-limit", info.limit.to_string()),
        ("x-ratelimit-remaining", info.remaining.to_string()),
        (
            "x-ratelimit-reset",
            (info.reset_at as f64 / 1000.0).ceil().to_string(),
        ),
    ]
}

/// Drops expired buckets, replacing the Node `setInterval(..., 60_000).unref()`.
/// Spawned as a background task that must not hold shutdown open.
pub fn spawn_cleanup() {
    tokio::spawn(async {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            ticker.tick().await;
            let now = now_ms();
            let mut map = buckets().lock().expect("rate limit mutex");
            map.retain(|_, b| now <= b.reset_at);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_up_to_the_limit_then_refuses() {
        let key = "test:allows-up-to-limit";
        for i in 0..3 {
            let r = rate_limit_info(key, 3, 60_000);
            assert!(r.ok, "request {i} should pass");
            assert_eq!(r.remaining, 2 - i);
        }
        let r = rate_limit_info(key, 3, 60_000);
        assert!(!r.ok);
        assert_eq!(r.remaining, 0);
    }

    #[test]
    fn a_new_window_resets_the_count() {
        let key = "test:window-resets";
        assert!(rate_limit(key, 1, 5), "first request opens the window");
        assert!(!rate_limit(key, 1, 5), "second request is over the limit");
        // The boundary is `now > reset_at`, so the window must actually elapse.
        std::thread::sleep(std::time::Duration::from_millis(15));
        assert!(rate_limit(key, 1, 5), "expired bucket starts over");
    }

    #[test]
    fn keys_are_independent() {
        assert!(rate_limit("test:key-a", 1, 60_000));
        assert!(rate_limit("test:key-b", 1, 60_000));
        assert!(!rate_limit("test:key-a", 1, 60_000));
    }
}

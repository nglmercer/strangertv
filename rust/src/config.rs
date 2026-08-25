//! Env-backed feature flags and runtime config.
//!
//! Port of `server/config.ts`. Env var names match exactly, so existing
//! deployments keep working without a config change.

use std::env;

fn bool_env(name: &str, fallback: bool) -> bool {
    match env::var(name) {
        Ok(v) if !v.is_empty() => v == "1" || v.eq_ignore_ascii_case("true") || v == "yes",
        _ => fallback,
    }
}

fn num_env(name: &str, fallback: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .map(|v| v as u64)
        .unwrap_or(fallback)
}

#[derive(Debug, Clone)]
pub struct Features {
    /// Allow anonymous match without login.
    pub anonymous_match: bool,
    /// Accept reports from unauthenticated clients.
    pub guest_reports: bool,
    /// Server accepts client WebRTC quality samples.
    pub quality_telemetry: bool,
    /// Require verified email for login/match when signed in.
    pub require_email_verified: bool,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub node_env: String,
    pub is_prod: bool,
    pub cors_origins: Vec<String>,
    pub app_url: String,
    /// Better Auth signs cookies and other derived session values with this
    /// secret. Production must provide it explicitly; development gets a
    /// stable local-only default so the server remains runnable out of the
    /// box without making an unsafe production fallback possible.
    pub better_auth_secret: String,
    pub admin_key: String,
    pub metrics_public: bool,
    pub static_dir: String,
    pub log_level: String,
    pub features: Features,
    pub drain_ms: u64,
}

impl Config {
    pub fn from_env() -> Self {
        let node_env = env::var("NODE_ENV").unwrap_or_else(|_| "development".into());
        let is_prod = node_env == "production";
        let better_auth_secret = env::var("BETTER_AUTH_SECRET").unwrap_or_else(|_| {
            if is_prod {
                String::new()
            } else {
                "development-only-better-auth-secret-change-me".into()
            }
        });
        Self {
            port: num_env("PORT", 8787) as u16,
            is_prod,
            node_env,
            cors_origins: env::var("CORS_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:5173,http://127.0.0.1:5173".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            app_url: env::var("APP_URL").unwrap_or_else(|_| "http://localhost:5173".into()),
            better_auth_secret,
            admin_key: env::var("ADMIN_KEY").unwrap_or_default(),
            metrics_public: bool_env("METRICS_PUBLIC", false),
            static_dir: env::var("STATIC_DIR").unwrap_or_default(),
            log_level: env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into()),
            features: Features {
                anonymous_match: bool_env("FEATURE_ANONYMOUS_MATCH", true),
                guest_reports: bool_env("FEATURE_GUEST_REPORTS", true),
                quality_telemetry: bool_env("FEATURE_QUALITY_TELEMETRY", true),
                require_email_verified: bool_env("FEATURE_REQUIRE_EMAIL_VERIFIED", false),
            },
            drain_ms: num_env("SHUTDOWN_DRAIN_MS", 8_000),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bool_env_accepts_the_same_truthy_spellings_as_the_node_version() {
        for v in ["1", "true", "TRUE", "yes"] {
            env::set_var("T_FLAG", v);
            assert!(bool_env("T_FLAG", false), "{v} should be truthy");
        }
        for v in ["0", "false", "no", ""] {
            env::set_var("T_FLAG", v);
            assert!(!bool_env("T_FLAG", false), "{v} should be falsy");
        }
        env::remove_var("T_FLAG");
        assert!(bool_env("T_FLAG", true), "unset falls back");
    }

    #[test]
    fn num_env_falls_back_on_garbage() {
        env::set_var("T_NUM", "abc");
        assert_eq!(num_env("T_NUM", 42), 42);
        env::set_var("T_NUM", "8080");
        assert_eq!(num_env("T_NUM", 42), 8080);
        env::remove_var("T_NUM");
    }
}

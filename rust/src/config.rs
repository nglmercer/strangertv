//! Env-backed feature flags and runtime config.
//!
//! Port of `server/config.ts`. Env var names match exactly, so existing
//! deployments keep working without a config change.

use std::env;

use crate::infra::client_ip::{parse_trusted_proxies, TrustedProxy};

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

/// Documented dev default for `ADMIN_KEY`. Non-production only; production
/// validation rejects it (it contains `change-me`). The server startup path
/// installs it into the environment so the `x-admin-key` gate honors it, and
/// logs a loud warning.
pub const DEV_ADMIN_KEY: &str = "dev-only-admin-key-change-me-localhost";

/// Values that are never acceptable as production secrets, matched
/// case-insensitively after trimming. Length floors apply on top.
const WEAK_SECRETS: &[&str] = &[
    "change-me",
    "changeme",
    "change-me-in-production",
    "secret",
    "admin",
    "admin123",
    "password",
    "password123",
    "test",
    "test-admin-key",
    "dev-turn-secret-change-me",
    "replace-with-at-least-32-random-bytes",
];

fn is_weak_secret(value: &str) -> bool {
    let v = value.trim().to_lowercase();
    if v.is_empty() {
        return true;
    }
    if WEAK_SECRETS.contains(&v.as_str()) {
        return true;
    }
    // Catch obvious derivations of the documented placeholders.
    v.contains("change-me") || v.contains("changeme")
}

/// Resolve the effective admin key without side effects. Production has no
/// fallback (an empty result fails [`Config::validate`]); any other
/// environment falls back to [`DEV_ADMIN_KEY`] so local development works
/// out of the box.
pub fn resolve_admin_key(is_prod: bool, raw: Option<String>) -> String {
    match raw {
        Some(v) if !v.trim().is_empty() => v,
        _ if !is_prod => DEV_ADMIN_KEY.into(),
        _ => String::new(),
    }
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
    /// Coturn-style REST secret (`TURN_SECRET`). Optional unless TURN is
    /// enabled (see [`Config::validate`]).
    pub turn_secret: String,
    /// Comma-separated `turn:`/`turns:` URLs (`TURN_URLS`). Empty disables TURN.
    pub turn_urls: String,
    pub metrics_public: bool,
    pub static_dir: String,
    pub log_level: String,
    pub features: Features,
    pub drain_ms: u64,
    /// Socket peers whose forwarded headers are honored. Parsed from
    /// `TRUSTED_PROXIES` (comma-separated IPs/CIDRs); empty trusts none.
    pub trusted_proxies: Vec<TrustedProxy>,
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
            admin_key: resolve_admin_key(is_prod, env::var("ADMIN_KEY").ok()),
            turn_secret: env::var("TURN_SECRET").unwrap_or_default(),
            turn_urls: env::var("TURN_URLS").unwrap_or_default(),
            metrics_public: bool_env("METRICS_PUBLIC", false),
            static_dir: env::var("STATIC_DIR").unwrap_or_default(),
            log_level: env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into()),
            features: Features {
                // Off by default: anonymous users have no server-verifiable
                // age, and video matchmaking is 18+.
                anonymous_match: bool_env("FEATURE_ANONYMOUS_MATCH", false),
                guest_reports: bool_env("FEATURE_GUEST_REPORTS", true),
                quality_telemetry: bool_env("FEATURE_QUALITY_TELEMETRY", true),
                require_email_verified: bool_env("FEATURE_REQUIRE_EMAIL_VERIFIED", false),
            },
            drain_ms: num_env("SHUTDOWN_DRAIN_MS", 8_000),
            trusted_proxies: parse_trusted_proxies(
                &env::var("TRUSTED_PROXIES").unwrap_or_default(),
            ),
        }
    }

    /// Fail-fast secret validation for server startup. Call before opening
    /// the database so a misconfigured production deploy exits immediately
    /// with an actionable message instead of serving with weak secrets.
    ///
    /// - Production (`NODE_ENV=production`) requires `ADMIN_KEY`: absent,
    ///   empty, shorter than 16 characters, or obviously insecure
    ///   (`change-me`, `secret`, `admin`, `test`, …) aborts startup.
    /// - Whenever TURN is enabled (`TURN_URLS` set, e.g. the compose `turn`
    ///   profile), `TURN_SECRET` must be strong in every environment: at
    ///   least 32 characters and not an obvious placeholder. TURN stays
    ///   optional: with `TURN_URLS` unset the secret is ignored.
    /// - Non-production environments skip the `ADMIN_KEY` check so local
    ///   development and test harnesses keep working with short throwaway
    ///   keys.
    pub fn validate(&self) -> Result<(), String> {
        if self.is_prod {
            if self.admin_key.trim().is_empty() {
                return Err(
                    "ADMIN_KEY is required in production (no default exists); \
                     set it to a random value of at least 16 characters"
                        .into(),
                );
            }
            if self.admin_key.len() < 16 {
                return Err(
                    "ADMIN_KEY must be at least 16 characters in production".into(),
                );
            }
            if is_weak_secret(&self.admin_key) {
                return Err(
                    "ADMIN_KEY is obviously insecure (placeholder or well-known \
                     value); set it to a random value of at least 16 characters"
                        .into(),
                );
            }
        }
        if !self.turn_urls.trim().is_empty() {
            if self.turn_secret.len() < 32 {
                return Err(
                    "TURN_SECRET must be at least 32 characters when TURN is \
                     enabled (TURN_URLS is set)"
                        .into(),
                );
            }
            if is_weak_secret(&self.turn_secret) {
                return Err(
                    "TURN_SECRET is obviously insecure (placeholder or \
                     well-known value); generate a random value of at least 32 \
                     characters"
                        .into(),
                );
            }
        }
        Ok(())
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

    /// Build a config for `validate` tests. `from_env` supplies the
    /// irrelevant fields and every field `validate` reads is overridden
    /// explicitly, so this helper never writes process env and parallel
    /// tests that mutate env cannot skew these assertions.
    fn test_config(is_prod: bool, admin_key: &str, turn_secret: &str, turn_urls: &str) -> Config {
        let mut config = Config::from_env();
        config.is_prod = is_prod;
        config.node_env = if is_prod { "production" } else { "test" }.into();
        config.admin_key = admin_key.to_string();
        config.turn_secret = turn_secret.to_string();
        config.turn_urls = turn_urls.to_string();
        config
    }

    #[test]
    fn dev_resolves_an_admin_default_but_production_has_none() {
        assert_eq!(
            resolve_admin_key(false, None),
            DEV_ADMIN_KEY,
            "non-production keeps an ergonomic default"
        );
        assert_eq!(
            resolve_admin_key(false, Some("".into())),
            DEV_ADMIN_KEY,
            "empty dev key falls back to the default"
        );
        assert_eq!(
            resolve_admin_key(false, Some("  ".into())),
            DEV_ADMIN_KEY,
            "blank dev key falls back to the default"
        );
        assert_eq!(
            resolve_admin_key(false, Some("my-key".into())),
            "my-key",
            "explicit dev key wins"
        );
        assert_eq!(
            resolve_admin_key(true, None),
            "",
            "production has no admin fallback"
        );
        assert_eq!(
            resolve_admin_key(true, Some("".into())),
            "",
            "empty production key stays empty so validation fails fast"
        );
        assert!(
            is_weak_secret(DEV_ADMIN_KEY),
            "the dev default must never pass production validation"
        );
    }

    #[test]
    fn production_rejects_missing_short_or_obviously_insecure_admin_keys() {
        for admin in ["", "   ", "short", "123456789012345"] {
            let config = test_config(true, admin, "", "");
            assert!(
                config.validate().is_err(),
                "production must reject admin key {admin:?}"
            );
        }
        // Obvious placeholders: exact weak values (any length) plus
        // derivations of the documented `change-me` placeholders. Matching
        // stays exact — beyond `change-me` — so a random key that merely
        // contains "test" or "admin" as a substring still passes.
        for admin in [
            "change-me",
            "secret",
            "admin",
            "test",
            "password",
            "test-admin-key",
            "change-me-in-production",
            "CHANGE-ME-IN-PRODUCTION",
            "change-me-with-suffix!",
            "my-changeme-key-012345",
        ] {
            let config = test_config(true, admin, "", "");
            assert!(
                config.validate().is_err(),
                "production must reject obvious placeholder {admin:?}"
            );
        }
        let config = test_config(true, "a-strong-random-admin-key-01", "", "");
        assert!(
            config.validate().is_ok(),
            "production accepts a strong admin key"
        );
    }

    #[test]
    fn non_production_accepts_throwaway_admin_keys() {
        for admin in ["", "itest-admin", "test-admin-key"] {
            let config = test_config(false, admin, "", "");
            assert!(
                config.validate().is_ok(),
                "dev/test must accept admin key {admin:?}"
            );
        }
    }

    #[test]
    fn enabled_turn_requires_a_strong_secret_in_every_environment() {
        for is_prod in [false, true] {
            for secret in [
                "",
                "short",
                "dev-turn-secret-change-me",
                "DEV-TURN-SECRET-CHANGE-ME",
                "turn-change-me-0123456789012345",
                "replace-with-at-least-32-random-bytes",
            ] {
                let config = test_config(
                    is_prod,
                    "a-strong-random-admin-key-01",
                    secret,
                    "turn:turn.example.com:3478",
                );
                assert!(
                    config.validate().is_err(),
                    "TURN enabled must reject secret {secret:?} (prod={is_prod})"
                );
            }
            let config = test_config(
                is_prod,
                "a-strong-random-admin-key-01",
                "a-strong-random-turn-secret-01234567",
                "turn:turn.example.com:3478",
            );
            assert!(
                config.validate().is_ok(),
                "TURN enabled accepts a strong secret (prod={is_prod})"
            );
        }
    }

    #[test]
    fn disabled_turn_ignores_the_secret() {
        for is_prod in [false, true] {
            let config = test_config(is_prod, "a-strong-random-admin-key-01", "", "");
            assert!(
                config.validate().is_ok(),
                "unset TURN_URLS leaves the secret unchecked (prod={is_prod})"
            );
        }
    }
}

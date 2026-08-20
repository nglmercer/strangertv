//! App version resolution. Port of `resolveVersion()` in `server/http.ts`,
//! including the `package.json` fallback so a dev run without env vars still
//! reports the real version.

use std::sync::OnceLock;

static VERSION: OnceLock<String> = OnceLock::new();

pub fn app_version() -> &'static str {
    VERSION.get_or_init(|| {
        if let Ok(v) = std::env::var("npm_package_version") {
            if !v.is_empty() {
                return v;
            }
        }
        if let Ok(v) = std::env::var("APP_VERSION") {
            if !v.is_empty() {
                return v;
            }
        }
        std::fs::read_to_string("package.json")
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|pkg| pkg.get("version")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| "0.0.0".into())
    })
}

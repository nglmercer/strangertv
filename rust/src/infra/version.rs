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
        // The Node version read package.json relative to the working
        // directory, which reports 0.0.0 whenever the process is started from
        // anywhere else (the dev loop runs from rust/). Baking the version in
        // at compile time removes that dependency; the test below keeps
        // Cargo.toml and package.json from drifting apart.
        env!("CARGO_PKG_VERSION").to_string()
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn cargo_and_npm_versions_agree() {
        let pkg: serde_json::Value =
            serde_json::from_str(include_str!("../../../package.json")).expect("package.json parses");
        assert_eq!(
            pkg["version"].as_str(),
            Some(env!("CARGO_PKG_VERSION")),
            "rust/Cargo.toml and package.json must declare the same version — \
             the API reports it as the app version"
        );
    }
}

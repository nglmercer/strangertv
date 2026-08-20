//! Structured JSON logging.
//!
//! Port of `server/logger.ts`. The line format is reproduced exactly —
//! `{"ts","level","msg",...fields}` — because log pipelines and the smoke
//! scripts grep for those keys.

use std::io::Write;
use std::sync::atomic::{AtomicU8, Ordering};

const DEBUG: u8 = 10;
const INFO: u8 = 20;
const WARN: u8 = 30;
const ERROR: u8 = 40;

static MIN_LEVEL: AtomicU8 = AtomicU8::new(INFO);

fn level_value(name: &str) -> u8 {
    match name {
        "debug" => DEBUG,
        "warn" => WARN,
        "error" => ERROR,
        _ => INFO,
    }
}

pub fn init(log_level: &str) {
    MIN_LEVEL.store(level_value(log_level), Ordering::Relaxed);
}

/// `2026-08-20T01:50:18.268Z` — exactly three subsecond digits, as
/// `Date.prototype.toISOString()` produces. `Rfc3339` would emit nanoseconds.
fn timestamp() -> String {
    use time::macros::format_description;
    const FMT: &[time::format_description::FormatItem<'_>] = format_description!(
        "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
    );
    time::OffsetDateTime::now_utc().format(FMT).unwrap_or_default()
}

pub fn log(level: &str, msg: &str, fields: serde_json::Value) {
    if level_value(level) < MIN_LEVEL.load(Ordering::Relaxed) {
        return;
    }
    let mut entry = serde_json::Map::new();
    entry.insert("ts".into(), timestamp().into());
    entry.insert("level".into(), level.into());
    entry.insert("msg".into(), msg.into());
    if let serde_json::Value::Object(map) = fields {
        entry.extend(map);
    }
    let line = serde_json::Value::Object(entry).to_string();
    if level == "error" || level == "warn" {
        let mut err = std::io::stderr().lock();
        let _ = writeln!(err, "{line}");
    } else {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{line}");
    }
}

/// `log_info!("server.listen", { "port": 8787 })`
#[macro_export]
macro_rules! log_info {
    ($msg:expr) => { $crate::infra::logger::log("info", $msg, serde_json::json!({})) };
    ($msg:expr, $fields:tt) => { $crate::infra::logger::log("info", $msg, serde_json::json!($fields)) };
}

#[macro_export]
macro_rules! log_warn {
    ($msg:expr) => { $crate::infra::logger::log("warn", $msg, serde_json::json!({})) };
    ($msg:expr, $fields:tt) => { $crate::infra::logger::log("warn", $msg, serde_json::json!($fields)) };
}

#[macro_export]
macro_rules! log_error {
    ($msg:expr) => { $crate::infra::logger::log("error", $msg, serde_json::json!({})) };
    ($msg:expr, $fields:tt) => { $crate::infra::logger::log("error", $msg, serde_json::json!($fields)) };
}

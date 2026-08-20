//! ICE server list. Port of `server/turn.ts`.
//!
//! Optional TURN: set `TURN_SECRET` + `TURN_URLS` (comma-separated). Uses
//! time-limited credentials in the coturn REST style — the username is
//! `<expiry unix ts>:<nonce>` and the credential is its base64 HMAC-SHA1.

use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha1::Sha1;

pub const STUN_SERVERS: &[&str] = &[
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
];

const TTL: u64 = 3600;

pub fn turn_configured() -> bool {
    std::env::var("TURN_SECRET").is_ok_and(|v| !v.is_empty())
        && std::env::var("TURN_URLS").is_ok_and(|v| !v.is_empty())
}

pub fn ice_servers() -> serde_json::Value {
    let stun: Vec<serde_json::Value> = STUN_SERVERS
        .iter()
        .map(|url| serde_json::json!({ "urls": url }))
        .collect();

    let secret = std::env::var("TURN_SECRET").unwrap_or_default();
    let urls: Vec<String> = std::env::var("TURN_URLS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if secret.is_empty() || urls.is_empty() {
        return serde_json::json!({ "iceServers": stun, "ttl": 0 });
    }

    let expiry = now_secs() + TTL;
    let mut nonce = [0u8; 4];
    rand::thread_rng().fill_bytes(&mut nonce);
    let username = format!("{expiry}:{}", hex::encode(nonce));

    let mut mac = Hmac::<Sha1>::new_from_slice(secret.as_bytes()).expect("hmac accepts any key length");
    mac.update(username.as_bytes());
    let credential = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());

    let mut servers = stun;
    servers.push(serde_json::json!({
        "urls": urls,
        "username": username,
        "credential": credential,
    }));
    serde_json::json!({ "iceServers": servers, "ttl": TTL })
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_turn_configured_only_stun_is_returned() {
        std::env::remove_var("TURN_SECRET");
        std::env::remove_var("TURN_URLS");
        let v = ice_servers();
        assert_eq!(v["ttl"], 0);
        assert_eq!(v["iceServers"].as_array().unwrap().len(), STUN_SERVERS.len());
        assert!(!turn_configured());
    }
}

//! Password and token hashing, byte-compatible with `server/auth.ts`.

use base64::Engine;
use rand::RngCore;
use scrypt::{scrypt, Params};
use sha2::{Digest, Sha256};

/// Node's `crypto.scrypt` defaults: N = 16384 (log2 = 14), r = 8, p = 1.
const LOG_N: u8 = 14;
const R: u32 = 8;
const P: u32 = 1;
/// `scrypt(password, salt, 64)` — the third argument is the key length.
const KEY_LEN: usize = 64;

fn params() -> Params {
    Params::new(LOG_N, R, P, KEY_LEN).expect("scrypt params are valid constants")
}

fn derive(password: &str, salt_str: &str) -> [u8; KEY_LEN] {
    let mut out = [0u8; KEY_LEN];
    // The salt is the ASCII of the hex STRING, not the 16 bytes it encodes.
    // `crypto.scrypt(password, salt, 64)` in Node takes `salt` as a string and
    // converts it with utf8 — decoding the hex here would derive a different
    // key and lock out every existing account.
    scrypt(password.as_bytes(), salt_str.as_bytes(), &params(), &mut out)
        .expect("output length matches params");
    out
}

/// Stored format: `<32 hex chars of salt>:<128 hex chars of key>`.
pub fn hash_password(password: &str) -> String {
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = hex::encode(salt_bytes);
    let key = derive(password, &salt);
    format!("{salt}:{}", hex::encode(key))
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let Some((salt, key_hex)) = stored.split_once(':') else {
        return false;
    };
    if salt.is_empty() || key_hex.is_empty() {
        return false;
    }
    let Ok(expected) = hex::decode(key_hex) else {
        return false;
    };
    let derived = derive(password, salt);
    if derived.len() != expected.len() {
        return false;
    }
    constant_time_eq(&derived, &expected)
}

/// Stand-in for `crypto.timingSafeEqual`.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// `createHash('sha256').update(token).digest('hex')`
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// `randomBytes(32).toString('base64url')`
pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Same shape check as `validCredentials` — the regex is `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
/// and the minimum password length is 8.
pub fn valid_credentials(email: &str, password: &str) -> bool {
    valid_email(email) && password.len() >= 8
}

fn valid_email(email: &str) -> bool {
    // `[^\s@]+ @ [^\s@]+ \. [^\s@]+`, anchored.
    let Some((local, rest)) = email.split_once('@') else {
        return false;
    };
    let ok = |s: &str| !s.is_empty() && !s.contains(['@', ' ', '\t', '\n', '\r']);
    if !ok(local) {
        return false;
    }
    // The domain must contain a dot with non-empty, @-free text on both sides.
    // `split_once` from the left mirrors the regex's greedy-but-anchored match.
    match rest.rsplit_once('.') {
        Some((host, tld)) => ok(host) && ok(tld),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_round_trip() {
        let stored = hash_password("password12");
        assert!(verify_password("password12", &stored));
        assert!(!verify_password("password13", &stored));
    }

    /// The stored encoding is data-on-disk: 32 hex chars of salt, a colon, then
    /// 128 hex chars of key. Changing it orphans every existing account.
    #[test]
    fn stored_format_matches_the_node_encoding() {
        let stored = hash_password("password12");
        let (salt, key) = stored.split_once(':').expect("colon separated");
        assert_eq!(salt.len(), 32, "16 random bytes as hex");
        assert_eq!(key.len(), 128, "64-byte key as hex");
        assert!(salt.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// THE compatibility test. This vector was produced by the Node server:
    ///
    ///   node -e "const {scrypt}=require('crypto');
    ///     scrypt('password12','0123456789abcdef0123456789abcdef',64,
    ///       (e,k)=>console.log(k.toString('hex')))"
    ///
    /// If this fails, the salt is being decoded from hex instead of used as the
    /// literal string, or the scrypt parameters do not match Node's defaults.
    /// Either way every existing password stops verifying.
    #[test]
    fn derives_the_same_key_as_node_scrypt() {
        const SALT: &str = "0123456789abcdef0123456789abcdef";
        const EXPECTED: &str = include_str!("../../tests/fixtures/node-scrypt-vector.txt");
        let key = derive("password12", SALT);
        assert_eq!(hex::encode(key), EXPECTED.trim());
    }

    #[test]
    fn verifies_a_hash_written_by_the_node_server() {
        // Full `salt:key` string as stored in the users table by auth.ts.
        const STORED: &str = include_str!("../../tests/fixtures/node-password-hash.txt");
        assert!(verify_password("password12", STORED.trim()));
        assert!(!verify_password("wrong-password", STORED.trim()));
    }

    #[test]
    fn malformed_stored_values_are_rejected_not_panicked_on() {
        for bad in ["", ":", "nocolon", "salt:", ":key", "salt:zzzz"] {
            assert!(!verify_password("password12", bad), "{bad:?}");
        }
    }

    #[test]
    fn token_hash_matches_sha256_hex() {
        // echo -n "abc" | sha256sum
        assert_eq!(
            hash_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn random_tokens_are_base64url_without_padding() {
        let t = random_token();
        assert_eq!(t.len(), 43, "32 bytes base64url, unpadded");
        assert!(!t.contains('='));
        assert!(!t.contains('+') && !t.contains('/'));
        assert_ne!(t, random_token());
    }

    #[test]
    fn credential_validation_matches_the_node_regex() {
        assert!(valid_credentials("a@b.co", "password12"));
        assert!(!valid_credentials("a@b.co", "short"), "min length 8");
        assert!(!valid_credentials("nodomain", "password12"));
        assert!(!valid_credentials("no@dot", "password12"));
        assert!(!valid_credentials("@b.co", "password12"));
        assert!(!valid_credentials("a b@c.co", "password12"), "no whitespace");
        assert!(!valid_credentials("a@b@c.co", "password12"), "one @ only");
        assert!(!valid_credentials("a@b.", "password12"));
    }
}

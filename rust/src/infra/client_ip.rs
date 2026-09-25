//! Central client-IP resolution with trusted-proxy gating.
//!
//! Forwarded headers (`x-forwarded-for`, `x-real-ip`) are only honored when
//! the direct socket peer is a configured trusted proxy. Otherwise the socket
//! peer address is the client IP, so an arbitrary client cannot spoof the
//! identity used for rate limits, bans, reports, and ratings.
//!
//! Configure with `TRUSTED_PROXIES`: a comma-separated list of IPs and CIDR
//! ranges (e.g. `10.0.0.1,10.0.0.0/8,2001:db8::/32`). Empty (the default)
//! trusts no proxy, and forwarded headers are always ignored.

use axum::http::HeaderMap;
use std::net::IpAddr;

const X_FORWARDED_FOR: &str = "x-forwarded-for";
const X_REAL_IP: &str = "x-real-ip";

/// One trusted-proxy entry: an exact IP or a CIDR range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrustedProxy {
    Exact(IpAddr),
    V4 { network: u32, prefix: u8 },
    V6 { network: u128, prefix: u8 },
}

/// Normalize `::ffff:a.b.c.d` to `a.b.c.d`: a dual-stack listener reports
/// IPv4 peers in mapped form, and trust must not depend on that detail.
fn normalize(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
        IpAddr::V4(_) => ip,
    }
}

impl TrustedProxy {
    fn matches(&self, peer: IpAddr) -> bool {
        match self {
            TrustedProxy::Exact(ip) => normalize(*ip) == normalize(peer),
            TrustedProxy::V4 { network, prefix } => match peer {
                IpAddr::V4(v4) => {
                    let mask = prefix_mask_v4(*prefix);
                    u32::from(v4) & mask == *network & mask
                }
                IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
                    Some(mapped) => {
                        let mask = prefix_mask_v4(*prefix);
                        u32::from(mapped) & mask == *network & mask
                    }
                    None => false,
                },
            },
            TrustedProxy::V6 { network, prefix } => match peer {
                IpAddr::V6(v6) => {
                    let mask = prefix_mask_v6(*prefix);
                    u128::from(v6) & mask == *network & mask
                }
                // An IPv4 peer never matches a v6 range, even a mapped one:
                // trust must be configured explicitly per family.
                IpAddr::V4(_) => false,
            },
        }
    }
}

fn prefix_mask_v4(prefix: u8) -> u32 {
    if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    }
}

fn prefix_mask_v6(prefix: u8) -> u128 {
    if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - prefix)
    }
}

/// Parse a comma-separated `TRUSTED_PROXIES` value. Blank and invalid entries
/// are ignored, so a typo fails closed to trusting fewer proxies.
pub fn parse_trusted_proxies(raw: &str) -> Vec<TrustedProxy> {
    raw.split(',')
        .filter_map(|entry| parse_trusted_proxy(entry.trim()))
        .collect()
}

fn parse_trusted_proxy(entry: &str) -> Option<TrustedProxy> {
    if entry.is_empty() {
        return None;
    }
    if let Some((addr, prefix)) = entry.split_once('/') {
        let prefix: u8 = prefix.trim().parse().ok()?;
        match addr.trim().parse::<IpAddr>().ok()? {
            IpAddr::V4(v4) if prefix <= 32 => Some(TrustedProxy::V4 {
                network: u32::from(v4),
                prefix,
            }),
            IpAddr::V6(v6) if prefix <= 128 => Some(TrustedProxy::V6 {
                network: u128::from(v6),
                prefix,
            }),
            _ => None,
        }
    } else {
        entry.parse::<IpAddr>().ok().map(TrustedProxy::Exact)
    }
}

/// True when the direct socket peer is a configured trusted proxy.
pub fn peer_is_trusted(peer: IpAddr, trusted: &[TrustedProxy]) -> bool {
    trusted.iter().any(|entry| entry.matches(peer))
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// Best-effort client IP from proxy headers alone: the leftmost
/// `x-forwarded-for` entry, else `x-real-ip`. Callers must only use this when
/// the socket peer is trusted — prefer [`resolve_client_ip`].
pub fn forwarded_ip(headers: &HeaderMap) -> Option<String> {
    if let Some(xff) = header(headers, X_FORWARDED_FOR) {
        if let Some(first) = xff.split(',').map(str::trim).find(|hop| !hop.is_empty()) {
            return Some(first.to_string());
        }
    }
    header(headers, X_REAL_IP)
        .map(str::trim)
        .filter(|ip| !ip.is_empty())
        .map(str::to_string)
}

/// Resolve the client IP for `headers` received from socket peer `peer`.
///
/// Forwarded headers are honored only when `peer` matches `trusted`; otherwise
/// the socket peer address is returned. With no peer (e.g. an in-process
/// call), forwarded headers are never trusted and the result is `unknown`.
pub fn resolve_client_ip(
    headers: &HeaderMap,
    peer: Option<IpAddr>,
    trusted: &[TrustedProxy],
) -> String {
    match peer {
        Some(peer) if peer_is_trusted(peer, trusted) => {
            forwarded_ip(headers).unwrap_or_else(|| peer.to_string())
        }
        Some(peer) => peer.to_string(),
        None => "unknown".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;
    use std::net::SocketAddr;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    fn peer(addr: &str) -> Option<IpAddr> {
        Some(addr.parse().unwrap())
    }

    fn socket_peer(addr: &str) -> SocketAddr {
        addr.parse().unwrap()
    }

    #[test]
    fn spoofed_forwarded_headers_are_ignored_when_no_proxy_is_trusted() {
        let h = headers(&[("x-forwarded-for", "1.2.3.4"), ("x-real-ip", "5.6.7.8")]);
        // Default config: empty trust list.
        assert_eq!(
            resolve_client_ip(&h, peer("203.0.113.9"), &[]),
            "203.0.113.9"
        );
    }

    #[test]
    fn spoofed_forwarded_headers_are_ignored_when_peer_is_not_trusted() {
        let trusted = parse_trusted_proxies("10.0.0.1");
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        assert_eq!(
            resolve_client_ip(&h, peer("203.0.113.9"), &trusted),
            "203.0.113.9"
        );
    }

    #[test]
    fn forwarded_headers_are_honored_for_a_trusted_proxy_peer() {
        let trusted = parse_trusted_proxies("10.0.0.1");
        let h = headers(&[("x-forwarded-for", "1.2.3.4, 10.0.0.1")]);
        assert_eq!(resolve_client_ip(&h, peer("10.0.0.1"), &trusted), "1.2.3.4");
    }

    #[test]
    fn leftmost_forwarded_entry_wins_and_real_ip_is_the_fallback() {
        let trusted = parse_trusted_proxies("10.0.0.1");
        let h = headers(&[
            ("x-forwarded-for", "  1.2.3.4 , 5.6.7.8"),
            ("x-real-ip", "9.9.9.9"),
        ]);
        assert_eq!(resolve_client_ip(&h, peer("10.0.0.1"), &trusted), "1.2.3.4");
        let h = headers(&[("x-real-ip", "  9.9.9.9  ")]);
        assert_eq!(resolve_client_ip(&h, peer("10.0.0.1"), &trusted), "9.9.9.9");
    }

    #[test]
    fn trusted_proxy_without_headers_falls_back_to_the_peer_address() {
        let trusted = parse_trusted_proxies("10.0.0.1");
        assert_eq!(
            resolve_client_ip(&HeaderMap::new(), peer("10.0.0.1"), &trusted),
            "10.0.0.1"
        );
    }

    #[test]
    fn direct_connection_without_headers_uses_the_peer_address() {
        assert_eq!(
            resolve_client_ip(&HeaderMap::new(), peer("203.0.113.9"), &[]),
            "203.0.113.9"
        );
    }

    #[test]
    fn missing_peer_is_unknown_and_never_trusts_headers() {
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        let trusted = parse_trusted_proxies("0.0.0.0/0");
        assert_eq!(resolve_client_ip(&h, None, &trusted), "unknown");
    }

    #[test]
    fn cidr_ranges_trust_their_members_only() {
        let trusted = parse_trusted_proxies("10.0.0.0/8, 192.168.1.0/24");
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        assert_eq!(resolve_client_ip(&h, peer("10.1.2.3"), &trusted), "1.2.3.4");
        assert_eq!(
            resolve_client_ip(&h, peer("192.168.1.77"), &trusted),
            "1.2.3.4"
        );
        assert_eq!(
            resolve_client_ip(&h, peer("192.168.2.1"), &trusted),
            "192.168.2.1"
        );
        assert_eq!(
            resolve_client_ip(&h, peer("203.0.113.9"), &trusted),
            "203.0.113.9"
        );
    }

    #[test]
    fn ipv6_exact_and_cidr_entries_work() {
        let trusted = parse_trusted_proxies("2001:db8::1, 2001:db8:1::/48");
        let h = headers(&[("x-forwarded-for", "2001:db8:ffff::7")]);
        assert_eq!(
            resolve_client_ip(&h, peer("2001:db8::1"), &trusted),
            "2001:db8:ffff::7"
        );
        assert_eq!(
            resolve_client_ip(&h, peer("2001:db8:1::99"), &trusted),
            "2001:db8:ffff::7"
        );
        assert_eq!(
            resolve_client_ip(&h, peer("2001:db8:2::1"), &trusted),
            "2001:db8:2::1"
        );
    }

    #[test]
    fn invalid_trusted_proxy_entries_are_ignored() {
        let trusted = parse_trusted_proxies("not-an-ip, 10.0.0.1/99, /24, , 10.0.0.1");
        assert_eq!(
            trusted,
            vec![TrustedProxy::Exact("10.0.0.1".parse().unwrap())]
        );
    }

    #[test]
    fn ipv4_mapped_ipv6_peer_matches_a_v4_entry() {
        let trusted = parse_trusted_proxies("10.0.0.1");
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        assert_eq!(
            resolve_client_ip(&h, peer("::ffff:10.0.0.1"), &trusted),
            "1.2.3.4"
        );
        // ... but an IPv4 peer never matches a v6 range.
        let trusted = parse_trusted_proxies("::ffff:0:0/96");
        assert_eq!(
            resolve_client_ip(&h, peer("10.0.0.1"), &trusted),
            "10.0.0.1"
        );
    }

    #[test]
    fn socket_peer_strings_resolve_like_parsed_ips() {
        // Guards the `SocketAddr -> IpAddr` handoff every handler performs.
        let trusted = parse_trusted_proxies("10.0.0.0/8");
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        let via_socket = resolve_client_ip(&h, Some(socket_peer("10.9.9.9:443").ip()), &trusted);
        assert_eq!(via_socket, "1.2.3.4");
        let via_socket =
            resolve_client_ip(&h, Some(socket_peer("203.0.113.9:5231").ip()), &trusted);
        assert_eq!(via_socket, "203.0.113.9");
    }

    // The rate-limit/ban identity every HTTP and WebSocket path derives from
    // the resolved IP: a spoofed header must not move the caller to another
    // bucket when the peer is untrusted.

    #[test]
    fn login_rate_limit_identity_uses_the_socket_peer_when_spoofed() {
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        let ip = resolve_client_ip(&h, peer("203.0.113.9"), &[]);
        assert_eq!(format!("login:{ip}"), "login:203.0.113.9");
    }

    #[test]
    fn reset_rate_limit_identity_uses_the_socket_peer_when_spoofed() {
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        let ip = resolve_client_ip(&h, peer("203.0.113.9"), &[]);
        assert_eq!(format!("reset:{ip}"), "reset:203.0.113.9");
    }

    #[test]
    fn ws_rate_limit_identity_uses_the_socket_peer_when_spoofed() {
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        let ip = resolve_client_ip(&h, peer("203.0.113.9"), &[]);
        assert_eq!(format!("wsjoin:{ip}"), "wsjoin:203.0.113.9");
        assert_eq!(format!("wschat:{ip}"), "wschat:203.0.113.9");
    }

    #[test]
    fn trusted_proxy_rate_limit_identity_uses_the_forwarded_client() {
        let trusted = parse_trusted_proxies("10.0.0.0/8");
        let h = headers(&[("x-forwarded-for", "1.2.3.4")]);
        let ip = resolve_client_ip(&h, peer("10.0.0.7"), &trusted);
        assert_eq!(format!("login:{ip}"), "login:1.2.3.4");
        assert_eq!(format!("wsjoin:{ip}"), "wsjoin:1.2.3.4");
    }
}

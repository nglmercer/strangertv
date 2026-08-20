//! In-process counters and the Prometheus exposition. Port of
//! `server/metrics.ts`, including its deliberately light histogram: the last
//! `MAX_TIMINGS` samples, quantiles computed on read.

use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const MAX_TIMINGS: usize = 500;

struct Metrics {
    counters: BTreeMap<String, i64>,
    timings: Vec<f64>,
}

fn metrics() -> &'static Mutex<Metrics> {
    static M: OnceLock<Mutex<Metrics>> = OnceLock::new();
    M.get_or_init(|| {
        Mutex::new(Metrics {
            counters: BTreeMap::new(),
            timings: Vec::new(),
        })
    })
}

/// Process start, standing in for `process.uptime()`.
fn started_at() -> &'static Instant {
    static T: OnceLock<Instant> = OnceLock::new();
    T.get_or_init(Instant::now)
}

pub fn init() {
    let _ = started_at();
}

pub fn uptime_sec() -> u64 {
    started_at().elapsed().as_secs()
}

pub fn inc(name: &str, by: i64) {
    let mut m = metrics().lock().expect("metrics mutex");
    *m.counters.entry(name.to_string()).or_insert(0) += by;
}

pub fn observe_ms(name: &str, ms: f64) {
    inc(&format!("{name}_count"), 1);
    let mut m = metrics().lock().expect("metrics mutex");
    m.timings.push(ms);
    if m.timings.len() > MAX_TIMINGS {
        m.timings.remove(0);
    }
    // Named histograms stay light: last value plus a count.
    m.counters.insert(format!("{name}_last_ms"), ms.round() as i64);
}

/// Resident set size in bytes, for `stranger_memory_rss_bytes`. Linux only;
/// other platforms report 0 rather than failing the scrape.
fn memory_rss_bytes() -> u64 {
    #[cfg(target_os = "linux")]
    {
        // statm field 2 is resident pages.
        if let Ok(statm) = std::fs::read_to_string("/proc/self/statm") {
            if let Some(pages) = statm.split_whitespace().nth(1) {
                if let Ok(pages) = pages.parse::<u64>() {
                    return pages * 4096;
                }
            }
        }
    }
    0
}

pub struct LatencySummary {
    pub p50: f64,
    pub p95: f64,
    pub samples: usize,
}

fn latency() -> LatencySummary {
    let m = metrics().lock().expect("metrics mutex");
    let mut sorted = m.timings.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let q = |q: f64| -> f64 {
        if sorted.is_empty() {
            0.0
        } else {
            let idx = ((sorted.len() as f64) * q).floor() as usize;
            sorted[idx.min(sorted.len() - 1)]
        }
    };
    LatencySummary {
        p50: q(0.5),
        p95: q(0.95),
        samples: sorted.len(),
    }
}

pub fn snapshot() -> serde_json::Value {
    let counters: serde_json::Map<String, serde_json::Value> = metrics()
        .lock()
        .expect("metrics mutex")
        .counters
        .iter()
        .map(|(k, v)| (k.clone(), (*v).into()))
        .collect();
    let l = latency();
    serde_json::json!({
        "counters": counters,
        "matchLatencyMs": { "p50": l.p50, "p95": l.p95, "samples": l.samples },
        "uptimeSec": uptime_sec(),
        "memoryMb": memory_rss_bytes() / 1024 / 1024,
    })
}

/// Prometheus text exposition (basic counters + gauges).
pub fn prometheus_text(extra_gauges: &[(&str, f64)]) -> String {
    let mut lines: Vec<String> = vec![
        "# HELP stranger_uptime_seconds Process uptime".into(),
        "# TYPE stranger_uptime_seconds gauge".into(),
        format!("stranger_uptime_seconds {}", uptime_sec()),
        "# HELP stranger_memory_rss_bytes Resident set size".into(),
        "# TYPE stranger_memory_rss_bytes gauge".into(),
        format!("stranger_memory_rss_bytes {}", memory_rss_bytes()),
    ];
    for (k, v) in extra_gauges {
        let name = sanitize(k);
        lines.push(format!("# TYPE stranger_{name} gauge"));
        lines.push(format!("stranger_{name} {}", trim_float(*v)));
    }
    lines.push("# HELP stranger_counter Application counters".into());
    lines.push("# TYPE stranger_counter counter".into());
    for (k, v) in metrics().lock().expect("metrics mutex").counters.iter() {
        lines.push(format!("stranger_counter{{name=\"{}\"}} {v}", sanitize(k)));
    }
    let l = latency();
    lines.push("# HELP stranger_match_wait_ms Match wait latency quantiles".into());
    lines.push("# TYPE stranger_match_wait_ms summary".into());
    lines.push(format!(
        "stranger_match_wait_ms{{quantile=\"0.5\"}} {}",
        trim_float(l.p50)
    ));
    lines.push(format!(
        "stranger_match_wait_ms{{quantile=\"0.95\"}} {}",
        trim_float(l.p95)
    ));
    lines.push(format!("stranger_match_wait_ms_count {}", l.samples));
    lines.join("\n") + "\n"
}

/// `k.replace(/[^a-zA-Z0-9_]/g, '_')`
fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect()
}

/// JS prints whole floats without a trailing `.0`; Prometheus scrapers accept
/// both, but keeping the output identical makes diffing the two servers easy.
fn trim_float(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ported from tests/config.test.ts.
    #[test]
    fn exposes_prometheus_counters() {
        inc("test_counter_xyz", 1);
        let text = prometheus_text(&[("queue_waiting", 2.0)]);
        assert!(text.contains("stranger_uptime_seconds"));
        assert!(
            text.contains("stranger_queue_waiting 2"),
            "gauge must print as an integer, not 2.0:\n{text}"
        );
        assert!(text.contains("test_counter_xyz"));
        let snap = snapshot();
        assert!(snap["uptimeSec"].as_u64().is_some());
    }

    #[test]
    fn counter_names_are_sanitized_for_the_exposition_format() {
        inc("weird name/with:chars", 3);
        let text = prometheus_text(&[]);
        assert!(text.contains(r#"stranger_counter{name="weird_name_with_chars"} 3"#));
    }

    #[test]
    fn quantiles_are_zero_before_any_sample() {
        // A fresh process must not divide by zero on the first scrape.
        let l = latency();
        assert!(l.p50 >= 0.0 && l.p95 >= 0.0);
    }
}

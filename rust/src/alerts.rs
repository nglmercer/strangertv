//! Report-rate alerting. Port of `server/alerts.ts`.

use std::sync::{Mutex, OnceLock};

use crate::infra::metrics::inc;

const WINDOW_MS: u64 = 5 * 60_000;

fn report_times() -> &'static Mutex<Vec<u64>> {
    static T: OnceLock<Mutex<Vec<u64>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(Vec::new()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn threshold() -> usize {
    std::env::var("ALERT_REPORTS_THRESHOLD")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10)
}

async fn post_alert(payload: serde_json::Value) {
    let Ok(url) = std::env::var("ALERT_WEBHOOK_URL") else {
        crate::log_warn!("alerts.event", { "payload": payload, "webhook": false });
        return;
    };
    if url.is_empty() {
        crate::log_warn!("alerts.event", { "payload": payload, "webhook": false });
        return;
    }
    let mut body = payload.clone();
    if let Some(obj) = body.as_object_mut() {
        obj.insert("ts".into(), serde_json::json!(iso_now()));
    }
    match reqwest::Client::new().post(&url).json(&body).send().await {
        Ok(_) => {
            inc("alerts_sent", 1);
            crate::log_warn!("alerts.sent", { "payload": payload });
        }
        Err(err) => crate::log_error!("alerts.webhook_failed", { "err": err.to_string() }),
    }
}

fn iso_now() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

/// Track report rate; if the threshold is exceeded, POST `ALERT_WEBHOOK_URL`.
///
/// An underage report always alerts on its own, and then still counts toward
/// the spike threshold — the Node version does not return early between the
/// two. Firing the spike alert clears the window as a cooldown, so it does not
/// re-fire on every subsequent report.
pub async fn note_report(reason: &str) {
    let now = now_ms();
    let count = {
        let mut times = report_times().lock().expect("alerts mutex");
        times.push(now);
        times.retain(|t| now.saturating_sub(*t) <= WINDOW_MS);
        times.len()
    };

    if reason == "underage" {
        inc("reports_underage", 1);
        post_alert(serde_json::json!({
            "type": "underage_report",
            "priority": "critical",
            "reason": reason,
            "recentReports": count,
        }))
        .await;
    }

    let threshold = threshold();
    if count < threshold {
        return;
    }

    post_alert(serde_json::json!({
        "type": "report_spike",
        "count": count,
        "windowMinutes": 5,
        "threshold": threshold,
    }))
    .await;
    // Cool down: clear the window so we do not spam.
    report_times().lock().expect("alerts mutex").clear();
}

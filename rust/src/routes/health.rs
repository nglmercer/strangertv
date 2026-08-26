//! Health, metrics, public config and ICE. Port of `server/routes/health.ts`.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::infra::http::client_ip;
use crate::infra::metrics::{prometheus_text, snapshot, uptime_sec};
use crate::infra::rate_limit::rate_limit;
use crate::infra::security::require_admin;
use crate::infra::version::app_version;
use crate::turn::{ice_servers, turn_configured};
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/docs", get(docs))
        .route("/api/v1/health", get(health))
        .route("/api/v1/health/live", get(live))
        .route("/api/v1/health/ready", get(ready))
        .route("/api/v1/metrics", get(metrics))
        .route("/api/v1/metrics/prometheus", get(metrics_prometheus))
        .route("/api/v1/config/public", get(config_public))
        .route("/api/v1/ice", get(ice))
        .with_state(state)
}

async fn docs(State(state): State<AppState>) -> Json<Value> {
    Json(crate::openapi::open_api_document(&state.config.app_url))
}

async fn live() -> Json<Value> {
    Json(json!({ "ok": true, "version": app_version() }))
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    let stats = state.engine.queue_stats().await;
    let draining = state.is_draining();
    Json(json!({
        "ok": !draining && state.db_ok(),
        "version": app_version(),
        "draining": draining,
        "waiting": stats.waiting,
        "online": stats.online,
        "database": state.db.kind(),
        "turn": turn_configured(),
        "uptimeSec": uptime_sec(),
        "features": {
            "anonymousMatch": state.config.features.anonymous_match,
            "guestReports": state.config.features.guest_reports,
            "qualityTelemetry": state.config.features.quality_telemetry,
            "requireEmailVerified": state.config.features.require_email_verified,
        },
    }))
}

/// Readiness doubles as the database liveness probe: a failing `SELECT 1` flips
/// the flag that `/health` reports.
async fn ready(State(state): State<AppState>) -> Response {
    if state.is_draining() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "ok": false, "reason": "draining" })),
        )
            .into_response();
    }
    match state.db.conn().query("SELECT 1", ()).await {
        Ok(_) => {
            state.set_db_ok(true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(_) => {
            state.set_db_ok(false);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "ok": false, "reason": "database" })),
            )
                .into_response()
        }
    }
}

async fn metrics(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    if !state.config.metrics_public && !require_admin(&headers) {
        return Err(ApiError::forbidden("Forbidden"));
    }
    let stats = state.engine.queue_stats().await;
    let mut out = snapshot();
    out["queue"] = json!({ "waiting": stats.waiting, "online": stats.online });
    out["draining"] = json!(state.is_draining());
    Ok(Json(out))
}

async fn metrics_prometheus(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.config.metrics_public && !require_admin(&headers) {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let stats = state.engine.queue_stats().await;
    let body = prometheus_text(&[
        ("queue_waiting", stats.waiting as f64),
        ("queue_online", stats.online as f64),
        ("draining", if state.is_draining() { 1.0 } else { 0.0 }),
    ]);
    ([("content-type", "text/plain; version=0.0.4")], body).into_response()
}

async fn config_public(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "features": {
            "anonymousMatch": state.config.features.anonymous_match,
            "qualityTelemetry": state.config.features.quality_telemetry,
        },
        "turnConfigured": turn_configured(),
        // The client only renders the Google button when the server can
        // actually complete the flow.
        "googleAuth": state.google_oauth.is_some(),
    }))
}

async fn ice(headers: HeaderMap) -> ApiResult<Json<Value>> {
    let ip = client_ip(&headers);
    if !rate_limit(&format!("ice:{ip}"), 30, 60_000) {
        return Err(ApiError::too_many("Too many requests"));
    }
    Ok(Json(ice_servers()))
}

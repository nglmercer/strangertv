//! Liveness/readiness. Port of the first slice of `server/routes/health.ts`;
//! the remaining endpoints (`/health`, `/metrics`, `/config/public`, `/ice`)
//! need the database and matchmaking state and land in Phase 3.

use axum::{routing::get, Json, Router};
use serde_json::json;

use crate::infra::version::app_version;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/health/live", get(live))
        .with_state(state)
}

async fn live() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "version": app_version() }))
}

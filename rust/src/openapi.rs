//! Minimal OpenAPI 3 document for the core HTTP APIs (not WS).
//! Port of `server/openapi.ts`.

use serde_json::{json, Map, Value};

pub fn open_api_document(app_url: &str) -> Value {
    let get = |summary: &str, secured: bool, responses: Value| -> Value {
        let mut op = Map::new();
        op.insert("summary".into(), json!(summary));
        if secured {
            op.insert("security".into(), json!([{ "bearerAuth": [] }]));
        }
        op.insert("responses".into(), responses);
        Value::Object(op)
    };
    let ok = |desc: &str| json!({ "200": { "description": desc } });

    json!({
        "openapi": "3.0.3",
        "info": {
            "title": "stranger API",
            "version": "1.0.0",
            "description": "HTTP API for stranger video chat. WebSocket signaling is at /ws.",
        },
        "servers": [{ "url": app_url }],
        "paths": {
            "/api/v1/health": { "get": get("Health summary", false, ok("OK")) },
            "/api/v1/health/live": { "get": get("Liveness", false, ok("Alive")) },
            "/api/v1/health/ready": {
                "get": get("Readiness", false, json!({
                    "200": { "description": "Ready" },
                    "503": { "description": "Not ready" },
                }))
            },
            "/api/v1/ice": { "get": get("ICE servers (STUN/TURN)", false, ok("ICE config")) },
            "/api/v1/auth/register": {
                "post": { "summary": "Register", "responses": { "201": { "description": "Created" } } }
            },
            "/api/v1/auth/login": {
                "post": { "summary": "Login", "responses": { "200": { "description": "Session token" } } }
            },
            "/api/v1/auth/logout": {
                "post": {
                    "summary": "Logout",
                    "security": [{ "bearerAuth": [] }],
                    "responses": { "200": { "description": "OK" } },
                }
            },
            "/api/v1/auth/me": { "get": get("Current user", true, ok("User")) },
            "/api/v1/auth/refresh": {
                "post": {
                    "summary": "Refresh session token",
                    "security": [{ "bearerAuth": [] }],
                    "responses": { "200": { "description": "New token" } },
                }
            },
            "/api/v1/auth/verify-email": {
                "post": { "summary": "Verify email token", "responses": { "200": { "description": "OK" } } }
            },
            "/api/v1/auth/oauth/google": {
                "get": {
                    "summary": "Start Google sign-in",
                    "responses": {
                        "302": { "description": "Redirect to Google" },
                        "404": { "description": "Provider not configured" },
                    },
                }
            },
            "/api/v1/auth/oauth/google/callback": {
                "get": {
                    "summary": "Google redirect target",
                    "responses": { "302": { "description": "Redirect back to the app" } },
                }
            },
            "/api/v1/auth/oauth/google/complete": {
                "post": {
                    "summary": "Finish a Google signup with a birth date",
                    "responses": {
                        "201": { "description": "Created" },
                        "400": { "description": "Expired token or under 18" },
                    },
                }
            },
            "/api/v1/blocks": {
                "get": get("List blocks", true, ok("Blocked users")),
                "post": {
                    "summary": "Block user by id",
                    "security": [{ "bearerAuth": [] }],
                    "responses": { "200": { "description": "OK" } },
                },
            },
            "/api/v1/reports": {
                "post": { "summary": "Submit report", "responses": { "200": { "description": "OK" } } }
            },
            "/api/v1/admin/overview": {
                "get": {
                    "summary": "Admin overview",
                    "parameters": [{
                        "name": "x-admin-key",
                        "in": "header",
                        "required": true,
                        "schema": { "type": "string" },
                    }],
                    "responses": { "200": { "description": "Metrics" } },
                }
            },
            "/api/v1/metrics": { "get": get("JSON metrics", false, ok("Counters")) },
            "/api/v1/metrics/prometheus": { "get": get("Prometheus text", false, ok("text/plain")) },
            "/api/v1/docs": { "get": get("This OpenAPI document", false, ok("OpenAPI JSON")) },
            "/api/v1/ratings": {
                "post": { "summary": "Rate a match (1–5)", "responses": { "200": { "description": "OK" } } }
            },
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": { "type": "http", "scheme": "bearer" },
            },
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_document_declares_the_routes_the_e2e_suite_checks() {
        let doc = open_api_document("http://x.test");
        assert!(doc["openapi"].as_str().unwrap().starts_with("3."));
        assert!(doc["paths"]["/api/v1/auth/refresh"].is_object());
        assert_eq!(doc["servers"][0]["url"], "http://x.test");
    }
}

//! Uniform error responses.
//!
//! The Node handlers return `c.json({ error: '...' }, status)` inline. This
//! type gives the Rust handlers the same shape from a `?`-friendly error,
//! keeping response bodies identical.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
    /// Optional machine-readable code, e.g. `email_unverified`.
    pub code: Option<String>,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            code: None,
        }
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "Unauthorized")
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }

    pub fn too_many(message: impl Into<String>) -> Self {
        Self::new(StatusCode::TOO_MANY_REQUESTS, message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = match self.code {
            Some(code) => json!({ "error": self.message, "code": code }),
            None => json!({ "error": self.message }),
        };
        (self.status, Json(body)).into_response()
    }
}

/// Any unexpected failure (database, serialization) becomes a 500 without
/// leaking internals to the client; the detail goes to the log instead.
impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        crate::log_error!("request.failed", { "message": err.to_string() });
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
    }
}

impl From<libsql::Error> for ApiError {
    fn from(err: libsql::Error) -> Self {
        crate::log_error!("db.query_failed", { "message": err.to_string() });
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

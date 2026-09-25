//! Per-user media blobs over HTTP: upload, serve, list, delete.
//!
//! Uploads arrive as JSON (`{kind, mime, data}` base64) so no multipart
//! dependency is needed; avatars stay well under axum's default body limit
//! even with the +33% base64 overhead. Serving is public by id with an
//! immutable cache lifetime — bytes never change, new uploads get new ids.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::resolver::resolve_authenticated_user_row;
use crate::auth::session::UserRow;
use crate::domain::media::{delete_media, get_media, list_media, store_media, MediaError};
use crate::error::{ApiError, ApiResult};
use crate::infra::rate_limit::rate_limit;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/media", get(list_mine).post(upload))
        .route("/api/v1/media/{id}", get(serve).delete(remove))
        .with_state(state)
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<UserRow> {
    resolve_authenticated_user_row(headers, state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)
}

impl From<MediaError> for ApiError {
    fn from(e: MediaError) -> Self {
        match e {
            MediaError::TooLarge(m) => ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, m),
            MediaError::UnsupportedType(m) | MediaError::Quota(m) => ApiError::bad_request(m),
            MediaError::NotFound(m) => ApiError::new(StatusCode::NOT_FOUND, m),
            MediaError::Forbidden(m) => ApiError::new(StatusCode::FORBIDDEN, m),
            MediaError::Db(err) => ApiError::from(err),
        }
    }
}

async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if !rate_limit(&format!("media:upload:{}", user.id), 20, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let kind = body.get("kind").and_then(Value::as_str).unwrap_or("");
    let mime = body.get("mime").and_then(Value::as_str).unwrap_or("");
    let data = body.get("data").and_then(Value::as_str).unwrap_or("");
    // Tolerate data: URLs from FileReader; raw base64 never contains a comma.
    let b64 = data.split_once(',').map(|(_, rest)| rest).unwrap_or(data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|_| ApiError::bad_request("Invalid file data"))?;
    let id = store_media(&state.db, user.id, kind, mime, &bytes).await?;
    Ok(Json(json!({ "id": id, "url": format!("/api/v1/media/{id}") })))
}

async fn serve(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    let Some(row) = get_media(&state.db, id).await.map_err(ApiError::from)? else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Media not found"));
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&row.mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok((headers, row.bytes))
}

async fn remove(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    delete_media(&state.db, id, user.id).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ListQuery {
    kind: Option<String>,
}

async fn list_mine(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if let Some(kind) = query.kind.as_deref() {
        if kind != crate::domain::media::KIND_AVATAR && kind != crate::domain::media::KIND_ICON {
            return Err(ApiError::bad_request("Unknown media kind"));
        }
    }
    let items = list_media(&state.db, user.id, query.kind.as_deref())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({
        "media": items
            .iter()
            .map(|m| json!({
                "id": m.id,
                "kind": m.kind,
                "mime": m.mime,
                "createdAt": m.created_at,
            }))
            .collect::<Vec<_>>(),
    })))
}

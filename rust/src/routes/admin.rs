//! Admin endpoints. Port of `server/routes/admin.ts`.
//!
//! Every route is gated on the `x-admin-key` header; an unset `ADMIN_KEY`
//! denies everyone.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use libsql::params;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::db::Db;
use crate::error::{ApiError, ApiResult};
use crate::infra::metrics::snapshot;
use crate::infra::security::require_admin;
use crate::AppState;

const REPORT_CSV_HEADERS: &[&str] = &[
    "id",
    "reporter_id",
    "reporter_session",
    "room_id",
    "reason",
    "detail",
    "status",
    "created_at",
];

const BAN_REASON_DEFAULT: &str = "moderation";

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/admin/overview", get(overview))
        .route("/api/v1/admin/reports", get(reports))
        .route("/api/v1/admin/reports.csv", get(reports_csv))
        .route("/api/v1/admin/reports/{id}", patch(patch_report))
        .route("/api/v1/admin/bans", get(bans))
        .route("/api/v1/admin/users", get(users))
        .route("/api/v1/admin/ban", post(ban))
        .route("/api/v1/admin/ban/{id}", delete(unban))
        .with_state(state)
}

fn gate(headers: &HeaderMap) -> ApiResult<()> {
    if require_admin(headers) {
        Ok(())
    } else {
        Err(ApiError::forbidden("Forbidden"))
    }
}

async fn count(db: &Db, sql: &str) -> i64 {
    let Ok(mut rows) = db.conn().query(sql, ()).await else {
        return 0;
    };
    match rows.next().await {
        Ok(Some(row)) => row.get(0).unwrap_or(0),
        _ => 0,
    }
}

async fn overview(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    gate(&headers)?;
    let db = &state.db;
    let stats = state.engine.queue_stats().await;

    let users = count(db, "SELECT COUNT(*) FROM users").await;
    let reports_total = count(db, "SELECT COUNT(*) FROM reports").await;
    // Older databases may predate the status column; fall back to the total.
    let open_reports = match db
        .conn()
        .query(
            "SELECT COUNT(*) FROM reports WHERE COALESCE(status, 'open') = 'open'",
            (),
        )
        .await
    {
        Ok(mut rows) => match rows.next().await {
            Ok(Some(row)) => row.get(0).unwrap_or(reports_total),
            _ => reports_total,
        },
        Err(_) => reports_total,
    };
    let underage_open = count(
        db,
        "SELECT COUNT(*) FROM reports WHERE reason = 'underage' AND COALESCE(status, 'open') = 'open'",
    )
    .await;
    let active_bans = count(
        db,
        "SELECT COUNT(*) FROM bans WHERE expires_at IS NULL OR expires_at > datetime('now')",
    )
    .await;

    // The ratings table may be missing on old databases.
    let mut ratings = json!({ "count": 0, "average": Value::Null });
    if let Ok(mut rows) = db
        .conn()
        .query("SELECT COUNT(*), AVG(score) FROM ratings", ())
        .await
    {
        if let Ok(Some(row)) = rows.next().await {
            let n: i64 = row.get(0).unwrap_or(0);
            let avg: Option<f64> = row.get::<f64>(1).ok();
            ratings = json!({
                "count": n,
                // Node rounds to 2 decimals via Number(avg.toFixed(2)).
                "average": avg.map(|a| (a * 100.0).round() / 100.0),
            });
        }
    }

    Ok(Json(json!({
        "queue": { "waiting": stats.waiting, "online": stats.online },
        "users": users,
        "reports": reports_total,
        "openReports": open_reports,
        "underageOpen": underage_open,
        "activeBans": active_bans,
        "ratings": ratings,
        "metrics": snapshot(),
        "version": "0.0.0",
    })))
}

/// Rows are returned as generic JSON objects, as `result.rows` did.
async fn rows_to_json(db: &Db, sql: &str) -> ApiResult<Vec<Value>> {
    let mut rows = db.conn().query(sql, ()).await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(row_to_json(&row));
    }
    Ok(out)
}

fn row_to_json(row: &libsql::Row) -> Value {
    let mut map = Map::new();
    let mut i = 0;
    while let Some(name) = row.column_name(i) {
        let value = match row.get_value(i) {
            Ok(libsql::Value::Null) | Err(_) => Value::Null,
            Ok(libsql::Value::Integer(n)) => json!(n),
            Ok(libsql::Value::Real(f)) => json!(f),
            Ok(libsql::Value::Text(s)) => json!(s),
            Ok(libsql::Value::Blob(b)) => json!(b),
        };
        map.insert(name.to_string(), value);
        i += 1;
    }
    Value::Object(map)
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}

async fn reports(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<StatusQuery>,
) -> ApiResult<Json<Value>> {
    gate(&headers)?;
    let reports = match q.status.as_deref() {
        Some(s @ ("open" | "resolved")) => {
            let mut rows = state
                .db
                .conn()
                .query(
                    "SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT 200",
                    params![s],
                )
                .await?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().await? {
                out.push(row_to_json(&row));
            }
            out
        }
        _ => rows_to_json(&state.db, "SELECT * FROM reports ORDER BY id DESC LIMIT 200").await?,
    };
    Ok(Json(json!({ "reports": reports })))
}

async fn reports_csv(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !require_admin(&headers) {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let rows = match rows_to_json(&state.db, "SELECT * FROM reports ORDER BY id DESC LIMIT 1000").await
    {
        Ok(rows) => rows,
        Err(err) => return err.into_response(),
    };

    let mut lines = vec![REPORT_CSV_HEADERS.join(",")];
    for row in rows {
        let cells: Vec<String> = REPORT_CSV_HEADERS
            .iter()
            .map(|h| csv_escape(row.get(*h).unwrap_or(&Value::Null)))
            .collect();
        lines.push(cells.join(","));
    }
    let body = lines.join("\n") + "\n";

    (
        [
            ("content-type", "text/csv"),
            ("content-disposition", "attachment; filename=\"reports.csv\""),
        ],
        body,
    )
        .into_response()
}

/// `/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s`, with null → "".
fn csv_escape(v: &Value) -> String {
    let s = match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if s.contains('"') || s.contains(',') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

async fn patch_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    gate(&headers)?;
    let status = body.get("status").and_then(Value::as_str).unwrap_or_default();
    if id == 0 || !matches!(status, "open" | "resolved") {
        return Err(ApiError::bad_request("Invalid request"));
    }
    state
        .db
        .conn()
        .execute("UPDATE reports SET status = ? WHERE id = ?", params![status, id])
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn bans(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    gate(&headers)?;
    let bans = rows_to_json(&state.db, "SELECT * FROM bans ORDER BY id DESC LIMIT 200").await?;
    Ok(Json(json!({ "bans": bans })))
}

#[derive(Deserialize)]
struct UserQuery {
    q: Option<String>,
}

async fn users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(uq): Query<UserQuery>,
) -> ApiResult<Json<Value>> {
    gate(&headers)?;
    let search = uq.q.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let users = match search {
        Some(q) => {
            let mut rows = state
                .db
                .conn()
                .query(
                    "SELECT id, email, birth_date, country, created_at FROM users
                     WHERE email LIKE ? ORDER BY id DESC LIMIT 50",
                    params![format!("%{}%", q.to_lowercase())],
                )
                .await?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().await? {
                out.push(row_to_json(&row));
            }
            out
        }
        None => {
            rows_to_json(
                &state.db,
                "SELECT id, email, birth_date, country, created_at FROM users ORDER BY id DESC LIMIT 50",
            )
            .await?
        }
    };
    Ok(Json(json!({ "users": users })))
}

async fn ban(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    gate(&headers)?;
    let user_id = body.get("userId").and_then(Value::as_i64);
    let ip = body.get("ip").and_then(Value::as_str);
    let reason = body
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or(BAN_REASON_DEFAULT);
    let expires = body.get("hours").and_then(Value::as_f64).map(|h| {
        use time::format_description::well_known::Rfc3339;
        (time::OffsetDateTime::now_utc() + time::Duration::seconds_f64(h * 3600.0))
            .format(&Rfc3339)
            .unwrap_or_default()
    });

    state
        .db
        .conn()
        .execute(
            "INSERT INTO bans (user_id, ip, reason, expires_at) VALUES (?, ?, ?, ?)",
            params![user_id, ip, reason, expires],
        )
        .await?;
    if let Some(user_id) = user_id {
        state
            .db
            .conn()
            .execute(
                "UPDATE sessions SET revoked = 1 WHERE user_id = ?",
                params![user_id],
            )
            .await?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn unban(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    gate(&headers)?;
    if id == 0 {
        return Err(ApiError::bad_request("Invalid id"));
    }
    state
        .db
        .conn()
        .execute("DELETE FROM bans WHERE id = ?", params![id])
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_cells_are_escaped_like_the_node_version() {
        assert_eq!(csv_escape(&Value::Null), "");
        assert_eq!(csv_escape(&json!("plain")), "plain");
        assert_eq!(csv_escape(&json!("has,comma")), "\"has,comma\"");
        assert_eq!(csv_escape(&json!("has\"quote")), "\"has\"\"quote\"");
        assert_eq!(csv_escape(&json!("has\nnewline")), "\"has\nnewline\"");
        assert_eq!(csv_escape(&json!(42)), "42");
    }
}

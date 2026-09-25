//! Public link profiles: read any user's links, save your own, claim a username.
//!
//! `GET /api/v1/profiles/:username` is public (a Linktree page needs no
//! login); the write endpoints require the session resolver.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, patch, put};
use axum::{Json, Router};
use libsql::params;
use serde_json::{json, Value};

use crate::auth::resolver::resolve_authenticated_user_row;
use crate::auth::session::UserRow;
use crate::domain::media::set_avatar;
use crate::domain::profiles::{
    assign_username, load_doc, normalize_username, suggest_username, valid_color, valid_layout,
    validate_username, ProfileDoc, MAX_BIO, MAX_DESC, MAX_DISPLAY_NAME, MAX_DOMAIN, MAX_ICON,
    MAX_LABEL, MAX_LINKS, MAX_TITLE, MAX_WEBSITE,
};
use crate::error::{ApiError, ApiResult};
use crate::infra::rate_limit::rate_limit;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/profiles/{username}", get(get_profile))
        .route("/api/v1/profiles/me", put(save_mine))
        .route("/api/v1/users/me/username", patch(set_username))
        .with_state(state)
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<UserRow> {
    resolve_authenticated_user_row(headers, state)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)
}

async fn get_profile(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> ApiResult<Json<ProfileDoc>> {
    let name = normalize_username(&username);
    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT id, username FROM users WHERE username = ? COLLATE NOCASE",
            params![name],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Profile not found"));
    };
    let user_id: i64 = row.get(0)?;
    let found: String = row.get(1)?;
    drop(rows);

    let doc = load_doc(state.db.conn(), user_id, &found)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(doc))
}

struct ValidLink {
    label: String,
    desc: String,
    domain: String,
    icon: String,
    color: String,
}

struct ValidSection {
    title: String,
    icon: String,
    layout: String,
    show_count: bool,
}

fn str_field(link: &Value, key: &str, max: usize, what: &str) -> ApiResult<String> {
    let value = link
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request(format!("Each link needs a {what}.")))?;
    if value.chars().count() > max {
        return Err(ApiError::bad_request(format!("{what} is too long.")));
    }
    Ok(value.to_string())
}

fn parse_links(body: &Value) -> ApiResult<Vec<ValidLink>> {
    let raw = body
        .get("links")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::bad_request("links must be an array."))?;
    if raw.len() > MAX_LINKS {
        return Err(ApiError::bad_request("Up to 8 links."));
    }
    raw.iter()
        .map(|link| {
            let color = str_field(link, "color", 7, "color")?;
            if !valid_color(&color) {
                return Err(ApiError::bad_request("Unknown accent color."));
            }
            Ok(ValidLink {
                label: str_field(link, "label", MAX_LABEL, "title")?,
                desc: str_field(link, "desc", MAX_DESC, "description")?,
                domain: str_field(link, "domain", MAX_DOMAIN, "domain")?,
                icon: str_field(link, "icon", MAX_ICON, "icon")?,
                color,
            })
        })
        .collect()
}

/// Optional header field: missing/null/blank reads as NULL so clears persist.
/// Over-long values 400 like every other profile field.
fn opt_header_field(body: &Value, key: &str, max: usize, what: &str) -> ApiResult<Option<String>> {
    let raw = body.get(key).and_then(Value::as_str).unwrap_or_default();
    let trimmed = raw.trim();
    if trimmed.chars().count() > max {
        return Err(ApiError::bad_request(format!("{what} is too long.")));
    }
    Ok(if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    })
}

fn parse_section(body: &Value) -> ApiResult<ValidSection> {
    let section = body
        .get("section")
        .filter(|v| v.is_object())
        .ok_or_else(|| ApiError::bad_request("section is required."))?;
    let layout = str_field(section, "layout", 7, "layout")?;
    if !valid_layout(&layout) {
        return Err(ApiError::bad_request("Unknown layout."));
    }
    let show_count = section
        .get("showCount")
        .and_then(Value::as_bool)
        .ok_or_else(|| ApiError::bad_request("section.showCount must be a boolean."))?;
    Ok(ValidSection {
        title: str_field(section, "title", MAX_TITLE, "title")?,
        icon: str_field(section, "icon", MAX_ICON, "icon")?,
        layout,
        show_count,
    })
}

async fn save_mine(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<ProfileDoc>> {
    let user = require_user(&state, &headers).await?;
    if !rate_limit(&format!("profiles:save:{}", user.id), 60, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let links = parse_links(&body)?;
    let section = parse_section(&body)?;

    let conn = state.db.conn();
    conn.execute(
        "DELETE FROM profile_links WHERE user_id = ?",
        params![user.id],
    )
    .await?;
    for (position, link) in links.iter().enumerate() {
        conn.execute(
            "INSERT INTO profile_links (user_id, position, label, description, domain, icon, color)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                user.id,
                position as i64,
                link.label.clone(),
                link.desc.clone(),
                link.domain.clone(),
                link.icon.clone(),
                link.color.clone()
            ],
        )
        .await?;
    }
    conn.execute(
        "INSERT INTO profile_sections (user_id, title, icon, layout, show_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           title = excluded.title, icon = excluded.icon,
           layout = excluded.layout, show_count = excluded.show_count",
        params![
            user.id,
            section.title,
            section.icon,
            section.layout,
            i64::from(section.show_count)
        ],
    )
    .await?;

    if let Some(profile) = body.get("profile").filter(|v| v.is_object()) {
        let display_name = opt_header_field(profile, "displayName", MAX_DISPLAY_NAME, "Display name")?;
        let bio = opt_header_field(profile, "bio", MAX_BIO, "Bio")?;
        let website = opt_header_field(profile, "website", MAX_WEBSITE, "Website")?;
        let opt = |v: Option<String>| v.map_or(libsql::Value::Null, libsql::Value::Text);
        conn.execute(
            "UPDATE users SET display_name = ?, bio = ?, website = ? WHERE id = ?",
            params![opt(display_name), opt(bio), opt(website), user.id],
        )
        .await?;
        // Avatar is a media id (or null to clear); absent leaves it alone.
        // Ownership and kind are validated: only the owner's avatar blobs stick.
        if let Some(avatar) = profile.get("avatar") {
            let media_id = if avatar.is_null() {
                None
            } else if let Some(id) = avatar.as_i64() {
                Some(id)
            } else {
                return Err(ApiError::bad_request("Invalid avatar."));
            };
            set_avatar(conn, user.id, media_id)
                .await
                .map_err(ApiError::from)?;
        }
    }

    // Belt and braces: accounts always get a username at register/backfill,
    // but a row inserted any other way still needs one before it can load.
    let username = match user.username.clone() {
        Some(name) => name,
        None => assign_username(conn, user.id, &suggest_username(&user.email))
            .await
            .map_err(ApiError::from)?,
    };
    let doc = load_doc(conn, user.id, &username)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(doc))
}

async fn set_username(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = require_user(&state, &headers).await?;
    if !rate_limit(&format!("profiles:rename:{}", user.id), 10, 60_000) {
        return Err(ApiError::too_many("Rate limit exceeded"));
    }
    let raw = body.get("username").and_then(Value::as_str).unwrap_or_default();
    let name = normalize_username(raw);
    validate_username(&name).map_err(ApiError::bad_request)?;

    let mut rows = state
        .db
        .conn()
        .query(
            "SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ? LIMIT 1",
            params![name.clone(), user.id],
        )
        .await?;
    let taken = rows.next().await?.is_some();
    drop(rows);
    if taken {
        return Err(ApiError::conflict("That username is taken."));
    }

    state
        .db
        .conn()
        .execute(
            "UPDATE users SET username = ? WHERE id = ?",
            params![name.clone(), user.id],
        )
        .await?;
    Ok(Json(json!({ "username": name })))
}

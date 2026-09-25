//! Profile links + username rules beneath the profile routes.
//!
//! Usernames are the public `/u/:handle` identity: lowercase, 3-20 chars,
//! `[a-z0-9_]`, unique case-insensitively. New users get one derived from
//! their email local-part (numeric suffix on collision); existing databases
//! are backfilled at migrate time so every account resolves.

use libsql::{params, Connection};
use serde::Serialize;

pub const MAX_LINKS: usize = 8;
pub const MAX_LABEL: usize = 60;
pub const MAX_DESC: usize = 120;
pub const MAX_DOMAIN: usize = 80;
pub const MAX_TITLE: usize = 30;
pub const MAX_ICON: usize = 4096;
pub const USERNAME_MIN: usize = 3;
pub const USERNAME_MAX: usize = 20;
pub const MAX_DISPLAY_NAME: usize = 40;
pub const MAX_BIO: usize = 160;
pub const MAX_WEBSITE: usize = 120;

/// Handles that would collide with routes or look official.
const RESERVED: &[&str] = &[
    "me", "admin", "api", "search", "support", "settings", "profiles", "users", "auth", "login",
    "register", "social", "u",
];

/// Trim + lowercase. Validation runs on the normalized form.
pub fn normalize_username(raw: &str) -> String {
    raw.trim().to_lowercase()
}

pub fn validate_username(name: &str) -> Result<(), &'static str> {
    if name.len() < USERNAME_MIN || name.len() > USERNAME_MAX {
        return Err("Usernames are 3-20 characters.");
    }
    if !name
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err("Usernames use lowercase letters, numbers, and _.");
    }
    if !name
        .bytes()
        .next()
        .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    {
        return Err("Usernames start with a letter or number.");
    }
    if RESERVED.contains(&name) {
        return Err("That username is reserved.");
    }
    Ok(())
}

/// `ada.lovelace@example.com` -> `ada_lovelace`, mirroring the display-name
/// fallback in `auth::oauth`. Always returns a valid base for `assign_username`.
pub fn suggest_username(email: &str) -> String {
    let local = email.split('@').next().unwrap_or_default().to_lowercase();
    let mut base: String = local
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() {
                b as char
            } else {
                '_'
            }
        })
        .collect();
    base = base.trim_matches('_').to_string();
    if base.len() < USERNAME_MIN {
        base = "user".to_string();
    }
    if base.len() > USERNAME_MAX {
        base.truncate(USERNAME_MAX);
        base = base.trim_end_matches('_').to_string();
    }
    if RESERVED.contains(&base.as_str()) {
        base.push_str("_u");
    }
    debug_assert!(validate_username(&base).is_ok());
    base
}

/// Claim `base` (or `base1`, `base2`, ...) for a user that has none.
/// Pre-checks each candidate so only genuine races hit the unique index.
pub async fn assign_username(
    conn: &Connection,
    user_id: i64,
    base: &str,
) -> anyhow::Result<String> {
    for suffix in 0..1000_u32 {
        let name = if suffix == 0 {
            base.to_string()
        } else {
            let digits = suffix.to_string().len();
            let stem_len = USERNAME_MAX.saturating_sub(digits);
            let mut stem = base.to_string();
            if stem.len() > stem_len {
                stem.truncate(stem_len);
                stem = stem.trim_end_matches('_').to_string();
            }
            format!("{stem}{suffix}")
        };
        if validate_username(&name).is_err() {
            continue;
        }
        let mut rows = conn
            .query(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1",
                params![name.clone()],
            )
            .await?;
        let taken = rows.next().await?.is_some();
        drop(rows);
        if taken {
            continue;
        }
        conn.execute(
            "UPDATE users SET username = ? WHERE id = ? AND username IS NULL",
            params![name.clone(), user_id],
        )
        .await?;
        return Ok(name);
    }
    anyhow::bail!("username space exhausted")
}

/// Fill usernames for rows that predate the column. Runs on every migrate;
/// a no-op once every account has one.
pub async fn backfill_usernames(conn: &Connection) -> anyhow::Result<()> {
    let mut rows = conn
        .query(
            "SELECT id, email FROM users WHERE username IS NULL",
            (),
        )
        .await?;
    let mut pending = Vec::new();
    while let Some(row) = rows.next().await? {
        let id: i64 = row.get(0)?;
        let email: String = row.get(1)?;
        pending.push((id, email));
    }
    drop(rows);
    for (id, email) in pending {
        let base = suggest_username(&email);
        assign_username(conn, id, &base).await?;
    }
    Ok(())
}

pub fn valid_color(color: &str) -> bool {
    matches!(color, "gray" | "green" | "orange" | "blue") || is_hex_color(color)
}

fn is_hex_color(color: &str) -> bool {
    color.len() == 7
        && color.as_bytes()[0] == b'#'
        && color.bytes().skip(1).all(|b| b.is_ascii_hexdigit())
}

pub fn valid_layout(layout: &str) -> bool {
    matches!(layout, "rows" | "compact" | "grid")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileLink {
    pub id: String,
    pub label: String,
    #[serde(rename = "desc")]
    pub description: String,
    pub domain: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSection {
    pub title: String,
    pub icon: String,
    pub layout: String,
    pub show_count: bool,
}

/// Load the public doc. Missing rows read as the documented defaults so a
/// brand-new account renders an empty section instead of a 404.
pub async fn load_doc(
    conn: &Connection,
    user_id: i64,
    username: &str,
) -> anyhow::Result<ProfileDoc> {
    let mut rows = conn
        .query(
            "SELECT id, label, description, domain, icon, color
             FROM profile_links WHERE user_id = ? ORDER BY position",
            params![user_id],
        )
        .await?;
    let mut links = Vec::new();
    while let Some(row) = rows.next().await? {
        let id: i64 = row.get(0)?;
        links.push(ProfileLink {
            id: id.to_string(),
            label: row.get(1)?,
            description: row.get(2)?,
            domain: row.get(3)?,
            icon: row.get(4)?,
            color: row.get(5)?,
        });
    }
    drop(rows);

    let mut rows = conn
        .query(
            "SELECT title, icon, layout, show_count FROM profile_sections WHERE user_id = ?",
            params![user_id],
        )
        .await?;
    let section = match rows.next().await? {
        Some(row) => {
            let show: i64 = row.get(3)?;
            ProfileSection {
                title: row.get(0)?,
                icon: row.get(1)?,
                layout: row.get(2)?,
                show_count: show != 0,
            }
        }
        None => ProfileSection {
            title: "Links".to_string(),
            icon: String::new(),
            layout: "rows".to_string(),
            show_count: true,
        },
    };
    drop(rows);

    let mut rows = conn
        .query(
            "SELECT display_name, bio, website, country, created_at, avatar_media_id
             FROM users WHERE id = ?",
            params![user_id],
        )
        .await?;
    let header_row = rows.next().await?;
    drop(rows);
    let text = |idx: i32| -> Option<String> {
        header_row
            .as_ref()
            .and_then(|row| row.get::<String>(idx).ok())
            .filter(|s| !s.is_empty())
    };
    let avatar_id: Option<i64> = header_row
        .as_ref()
        .and_then(|row| row.get::<i64>(5).ok())
        .filter(|id| *id > 0);
    let avatar_url: Option<String> = avatar_id.map(|id| format!("/api/v1/media/{id}"));
    let (follower_count, following_count) =
        crate::domain::friends::follow_counts(conn, user_id).await?;

    Ok(ProfileDoc {
        user_id,
        username: username.to_string(),
        header: ProfileHeader {
            display_name: text(0),
            bio: text(1),
            website: text(2),
            avatar_url,
            avatar_id,
            country: text(3),
            joined_at: text(4),
            follower_count,
            following_count,
        },
        links,
        section,
    })
}

/// Public header identity for `/u/:handle`: display name, bio, website,
/// location and join date, plus the follow counts the stats row renders.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileHeader {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub website: Option<String>,
    pub avatar_url: Option<String>,
    pub avatar_id: Option<i64>,
    pub country: Option<String>,
    pub joined_at: Option<String>,
    pub follower_count: i64,
    pub following_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDoc {
    pub user_id: i64,
    pub username: String,
    pub header: ProfileHeader,
    pub links: Vec<ProfileLink>,
    pub section: ProfileSection,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames_accept_the_documented_shape() {
        assert!(validate_username("ada").is_ok());
        assert!(validate_username("ada_lovelace99").is_ok());
        assert!(validate_username("a".repeat(20).as_str()).is_ok());
    }

    #[test]
    fn usernames_reject_lengths_shapes_and_reserved() {
        assert!(validate_username("ab").is_err());
        assert!(validate_username("a".repeat(21).as_str()).is_err());
        assert!(validate_username("Ada").is_err());
        assert!(validate_username("ada-love").is_err());
        assert!(validate_username("_ada").is_err());
        assert!(validate_username("admin").is_err());
        assert!(validate_username("me").is_err());
    }

    #[test]
    fn suggestions_are_always_valid_bases() {
        assert_eq!(suggest_username("ada@example.com"), "ada");
        assert_eq!(suggest_username("Ada.Lovelace@example.com"), "ada_lovelace");
        assert_eq!(suggest_username("@example.com"), "user");
        assert_eq!(suggest_username("ab@example.com"), "user");
        assert_eq!(suggest_username("admin@example.com"), "admin_u");
        let long = format!("{}@example.com", "a".repeat(30));
        assert_eq!(suggest_username(&long), "a".repeat(20));
        for email in ["a@b.co", "x_y-9@z.io", "...@e.com", "ME@E.COM"] {
            assert!(validate_username(&suggest_username(email)).is_ok());
        }
    }

    #[test]
    fn colors_accept_presets_and_strict_hex() {
        assert!(valid_color("green"));
        assert!(valid_color("#aabbcc"));
        assert!(!valid_color("#abc"));
        assert!(!valid_color("red"));
        assert!(!valid_color("#zzzzzz"));
    }

    #[test]
    fn layouts_accept_the_three_modes() {
        assert!(valid_layout("rows"));
        assert!(valid_layout("compact"));
        assert!(valid_layout("grid"));
        assert!(!valid_layout("masonry"));
    }
}

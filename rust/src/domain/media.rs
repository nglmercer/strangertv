//! Per-user media blobs: profile avatars and custom link icons.
//!
//! Small storage on purpose: raster images only (PNG/JPEG/WebP) with tight
//! byte caps and a per-user icon quota. Blobs are immutable — a new upload
//! gets a new id — so serving sets a far-future cache lifetime. SVG is
//! deliberately excluded: an `<img>` can't script it, but the raw public URL
//! would serve scriptable markup to anyone opening it directly.

use libsql::{params, Connection};

use crate::db::Db;

pub const KIND_AVATAR: &str = "avatar";
pub const KIND_ICON: &str = "icon";
pub const KIND_GROUP: &str = "group";
pub const MAX_AVATAR_BYTES: usize = 512 * 1024;
pub const MAX_ICON_BYTES: usize = 256 * 1024;
pub const MAX_GROUP_BYTES: usize = 512 * 1024;
pub const MAX_ICONS_PER_USER: i64 = 20;

pub fn is_valid_kind(kind: &str) -> bool {
    matches!(kind, KIND_AVATAR | KIND_ICON | KIND_GROUP)
}

const ALLOWED_MIME: &[&str] = &["image/png", "image/jpeg", "image/webp"];

#[derive(Debug)]
pub enum MediaError {
    TooLarge(&'static str),
    UnsupportedType(&'static str),
    Quota(&'static str),
    NotFound(&'static str),
    Forbidden(&'static str),
    Db(anyhow::Error),
}

impl From<libsql::Error> for MediaError {
    fn from(e: libsql::Error) -> Self {
        MediaError::Db(e.into())
    }
}

/// Magic bytes must agree with the claimed MIME; the extension never does.
fn sniffed_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12
        && bytes.starts_with(b"RIFF")
        && bytes[8..12] == *b"WEBP"
    {
        Some("image/webp")
    } else {
        None
    }
}

fn cap_for(kind: &str) -> Result<usize, MediaError> {
    match kind {
        KIND_AVATAR => Ok(MAX_AVATAR_BYTES),
        KIND_ICON => Ok(MAX_ICON_BYTES),
        KIND_GROUP => Ok(MAX_GROUP_BYTES),
        _ => Err(MediaError::UnsupportedType("Unknown media kind")),
    }
}

pub async fn store_media(
    db: &Db,
    user_id: i64,
    kind: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<i64, MediaError> {
    let cap = cap_for(kind)?;
    if !ALLOWED_MIME.contains(&mime) {
        return Err(MediaError::UnsupportedType(
            "Only PNG, JPEG, and WebP uploads are supported",
        ));
    }
    if sniffed_mime(bytes) != Some(mime) {
        return Err(MediaError::UnsupportedType(
            "File contents do not match the claimed image type",
        ));
    }
    if bytes.len() > cap {
        return Err(MediaError::TooLarge("File is too large"));
    }
    if kind == KIND_ICON {
        let mut rows = db
            .conn()
            .query(
                "SELECT COUNT(*) FROM media WHERE user_id = ? AND kind = 'icon'",
                params![user_id],
            )
            .await?;
        let count: i64 = match rows.next().await? {
            Some(row) => row.get(0)?,
            None => 0,
        };
        if count >= MAX_ICONS_PER_USER {
            return Err(MediaError::Quota("Icon library is full"));
        }
    }
    db.conn()
        .execute(
            "INSERT INTO media (user_id, kind, mime, bytes) VALUES (?, ?, ?, ?)",
            params![user_id, kind, mime, bytes],
        )
        .await?;
    Ok(db.conn().last_insert_rowid())
}

pub struct MediaRow {
    pub mime: String,
    pub bytes: Vec<u8>,
}

pub async fn get_media(db: &Db, id: i64) -> anyhow::Result<Option<MediaRow>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT id, user_id, kind, mime, bytes FROM media WHERE id = ?",
            params![id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    Ok(Some(MediaRow {
        mime: row.get(3)?,
        bytes: row.get(4)?,
    }))
}

pub struct MediaMeta {
    pub id: i64,
    pub kind: String,
    pub mime: String,
    pub created_at: String,
}

pub async fn list_media(
    db: &Db,
    user_id: i64,
    kind: Option<&str>,
) -> anyhow::Result<Vec<MediaMeta>> {
    if let Some(k) = kind {
        cap_for(k).map_err(|_| anyhow::anyhow!("Unknown media kind"))?;
    }
    let mut rows = match kind {
        Some(k) => {
            db.conn()
                .query(
                    "SELECT id, kind, mime, created_at FROM media
                     WHERE user_id = ? AND kind = ? ORDER BY id DESC",
                    params![user_id, k],
                )
                .await?
        }
        None => {
            db.conn()
                .query(
                    "SELECT id, kind, mime, created_at FROM media
                     WHERE user_id = ? ORDER BY id DESC",
                    params![user_id],
                )
                .await?
        }
    };
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(MediaMeta {
            id: row.get(0)?,
            kind: row.get(1)?,
            mime: row.get(2)?,
            created_at: row.get(3)?,
        });
    }
    Ok(out)
}

/// The blob's kind after proving ownership. Shared by avatar, icon, and
/// group-image setters so every one enforces the same rule.
pub async fn kind_for_owner(
    conn: &Connection,
    id: i64,
    user_id: i64,
) -> Result<String, MediaError> {
    let mut rows = conn
        .query(
            "SELECT user_id, kind FROM media WHERE id = ?",
            params![id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Err(MediaError::NotFound("Media not found"));
    };
    let owner: i64 = row.get(0)?;
    if owner != user_id {
        return Err(MediaError::Forbidden("Not your upload"));
    }
    Ok(row.get(1)?)
}

/// Owner-only delete. Deleting the active avatar also clears it from the
/// profile so the header falls back to initials.
pub async fn delete_media(db: &Db, id: i64, user_id: i64) -> Result<(), MediaError> {
    let kind = kind_for_owner(db.conn(), id, user_id).await?;
    if kind == KIND_AVATAR {
        db.conn()
            .execute(
                "UPDATE users SET avatar_media_id = NULL WHERE id = ? AND avatar_media_id = ?",
                params![user_id, id],
            )
            .await?;
    }
    db.conn()
        .execute("DELETE FROM media WHERE id = ?", params![id])
        .await?;
    Ok(())
}

/// Point the profile avatar at an owned avatar blob (`None` clears it).
/// Replacing deletes the previous blob: one avatar per user bounds storage.
pub async fn set_avatar(
    conn: &Connection,
    user_id: i64,
    media_id: Option<i64>,
) -> Result<(), MediaError> {
    if let Some(id) = media_id {
        let kind = kind_for_owner(conn, id, user_id).await?;
        if kind != KIND_AVATAR {
            return Err(MediaError::UnsupportedType("Not an avatar upload"));
        }
    }
    let mut rows = conn
        .query(
            "SELECT avatar_media_id FROM users WHERE id = ?",
            params![user_id],
        )
        .await?;
    let previous: Option<i64> = match rows.next().await? {
        Some(row) => row.get(0).ok(),
        None => None,
    };
    drop(rows);
    match media_id {
        Some(id) => {
            conn.execute(
                "UPDATE users SET avatar_media_id = ? WHERE id = ?",
                params![id, user_id],
            )
            .await?;
        }
        None => {
            conn.execute(
                "UPDATE users SET avatar_media_id = NULL WHERE id = ?",
                params![user_id],
            )
            .await?;
        }
    }
    if let Some(old) = previous {
        if Some(old) != media_id {
            conn.execute("DELETE FROM media WHERE id = ?", params![old])
                .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1x1 transparent PNG.
    const PIXEL_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
        0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
        0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
        0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    async fn seeded_db() -> Db {
        let db = Db::open(":memory:").await.expect("in-memory db");
        db.migrate().await.expect("migrate");
        for id in 1..=2 {
            db.conn()
                .execute(
                    "INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
                    params![id, format!("u{id}@test")],
                )
                .await
                .expect("seed user");
        }
        db
    }

    #[tokio::test]
    async fn avatar_roundtrips_and_lists() {
        let db = seeded_db().await;
        let id = store_media(&db, 1, KIND_AVATAR, "image/png", PIXEL_PNG)
            .await
            .unwrap();
        let row = get_media(&db, id).await.unwrap().expect("stored");
        assert_eq!(row.bytes, PIXEL_PNG);
        assert_eq!(row.mime, "image/png");
        let listed = list_media(&db, 1, None).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert!(list_media(&db, 2, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_type_mismatch_and_oversize() {
        let db = seeded_db().await;
        assert!(matches!(
            store_media(&db, 1, KIND_ICON, "image/gif", PIXEL_PNG).await,
            Err(MediaError::UnsupportedType(_))
        ));
        // PNG bytes claimed as JPEG: the sniff disagrees.
        assert!(matches!(
            store_media(&db, 1, KIND_ICON, "image/jpeg", PIXEL_PNG).await,
            Err(MediaError::UnsupportedType(_))
        ));
        let mut big = [0xFF, 0xD8, 0xFF, 0x00].repeat(MAX_ICON_BYTES / 4 + 1);
        big.truncate(MAX_ICON_BYTES + 1);
        assert!(matches!(
            store_media(&db, 1, KIND_ICON, "image/jpeg", &big).await,
            Err(MediaError::TooLarge(_))
        ));
    }

    #[tokio::test]
    async fn icon_quota_caps_the_library() {
        let db = seeded_db().await;
        for _ in 0..MAX_ICONS_PER_USER {
            store_media(&db, 1, KIND_ICON, "image/png", PIXEL_PNG)
                .await
                .unwrap();
        }
        assert!(matches!(
            store_media(&db, 1, KIND_ICON, "image/png", PIXEL_PNG).await,
            Err(MediaError::Quota(_))
        ));
        // Another user's quota is untouched.
        store_media(&db, 2, KIND_ICON, "image/png", PIXEL_PNG)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn avatar_replace_clears_and_deletes() {
        let db = seeded_db().await;
        let first = store_media(&db, 1, KIND_AVATAR, "image/png", PIXEL_PNG)
            .await
            .unwrap();
        set_avatar(db.conn(), 1, Some(first)).await.unwrap();
        let second = store_media(&db, 1, KIND_AVATAR, "image/png", PIXEL_PNG)
            .await
            .unwrap();
        set_avatar(db.conn(), 1, Some(second)).await.unwrap();
        assert!(get_media(&db, first).await.unwrap().is_none());
        assert!(get_media(&db, second).await.unwrap().is_some());

        // Foreign blobs and icons can't become the avatar.
        let foreign = store_media(&db, 2, KIND_AVATAR, "image/png", PIXEL_PNG)
            .await
            .unwrap();
        assert!(matches!(
            set_avatar(db.conn(), 1, Some(foreign)).await,
            Err(MediaError::Forbidden(_))
        ));
        let icon = store_media(&db, 1, KIND_ICON, "image/png", PIXEL_PNG)
            .await
            .unwrap();
        assert!(matches!(
            set_avatar(db.conn(), 1, Some(icon)).await,
            Err(MediaError::UnsupportedType(_))
        ));

        set_avatar(db.conn(), 1, None).await.unwrap();
        assert!(get_media(&db, second).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_is_owner_only_and_clears_active_avatar() {
        let db = seeded_db().await;
        let id = store_media(&db, 1, KIND_AVATAR, "image/png", PIXEL_PNG)
            .await
            .unwrap();
        set_avatar(db.conn(), 1, Some(id)).await.unwrap();
        assert!(matches!(
            delete_media(&db, id, 2).await,
            Err(MediaError::Forbidden(_))
        ));
        delete_media(&db, id, 1).await.unwrap();
        assert!(get_media(&db, id).await.unwrap().is_none());
        // Clearing already happened: setting None again is a no-op success.
        set_avatar(db.conn(), 1, None).await.unwrap();
    }
}

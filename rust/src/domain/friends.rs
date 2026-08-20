//! Friends, follows and match invitations. Port of `server/friends.ts`.
//!
//! Note the asymmetry baked into the `friends` table: `user_a_id` is the
//! requester and `user_b_id` the recipient, and only `user_b_id` may accept or
//! decline. A re-request after a decline rewrites both columns so the new
//! requester lands in `user_a_id`.

use libsql::{params, Row};

use crate::db::Db;
use crate::proto::{Gender, PublicUser};

/// `publicUserFromRow` — reads a joined user with a column prefix.
///
/// Unlike `auth::session::public_user`, absent columns stay `None` here rather
/// than defaulting; this shape feeds list endpoints where the client renders
/// whatever is present.
fn public_user_from_row(row: &Row, base: i32) -> anyhow::Result<PublicUser> {
    let interests: Option<String> = row.get(base + 6).ok();
    Ok(PublicUser {
        id: row.get(base).unwrap_or(0),
        email: row.get(base + 1).unwrap_or_default(),
        birth_date: row.get(base + 2).ok(),
        gender: row
            .get::<String>(base + 3)
            .ok()
            .and_then(|g| gender_from_str(&g)),
        country: row.get(base + 4).ok(),
        language: row.get(base + 5).ok(),
        interests: interests.and_then(|s| serde_json::from_str(&s).ok()),
        email_verified: row.get::<i64>(base + 7).ok().map(|v| v != 0),
    })
}

fn gender_from_str(s: &str) -> Option<Gender> {
    match s {
        "any" => Some(Gender::Any),
        "male" => Some(Gender::Male),
        "female" => Some(Gender::Female),
        "other" => Some(Gender::Other),
        _ => None,
    }
}

/// The joined user columns, in the order `public_user_from_row` expects.
const USER_COLS: &str = "u.id, u.email, u.birth_date, u.gender, u.country, u.language, u.interests, u.email_verified";

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

pub struct FriendRow {
    pub id: i64,
    pub user_a_id: i64,
    pub user_b_id: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub other_user: PublicUser,
}

pub async fn get_friends(db: &Db, user_id: i64) -> anyhow::Result<Vec<FriendRow>> {
    let sql = format!(
        "SELECT f.id, f.user_a_id, f.user_b_id, f.status, f.created_at, f.updated_at, {USER_COLS}
         FROM friends f
         JOIN users u ON u.id = CASE
           WHEN f.user_a_id = ? THEN f.user_b_id
           WHEN f.user_b_id = ? THEN f.user_a_id
         END
         WHERE (f.user_a_id = ? OR f.user_b_id = ?)
         ORDER BY f.updated_at DESC"
    );
    let mut rows = db
        .conn()
        .query(&sql, params![user_id, user_id, user_id, user_id])
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(FriendRow {
            id: row.get(0)?,
            user_a_id: row.get(1)?,
            user_b_id: row.get(2)?,
            status: row.get(3)?,
            created_at: row.get(4).unwrap_or_default(),
            updated_at: row.get(5).unwrap_or_default(),
            other_user: public_user_from_row(&row, 6)?,
        });
    }
    Ok(out)
}

/// Not reachable from any route: the pending-request list is delivered over
/// the WebSocket instead. The TypeScript had the same dead export, which has
/// now been removed there; this one is kept because the tests below use it to
/// assert the requester/recipient asymmetry.
#[allow(dead_code)]
pub struct PendingRequest {
    pub id: i64,
    pub requester_id: i64,
    pub status: String,
    pub created_at: String,
    pub requester: PublicUser,
}

#[allow(dead_code)]
pub async fn get_pending_friend_requests(
    db: &Db,
    user_id: i64,
) -> anyhow::Result<Vec<PendingRequest>> {
    let sql = format!(
        "SELECT f.id, f.user_a_id, f.status, f.created_at, {USER_COLS}
         FROM friends f
         JOIN users u ON u.id = f.user_a_id
         WHERE f.user_b_id = ? AND f.status = 'pending'
         ORDER BY f.created_at DESC"
    );
    let mut rows = db.conn().query(&sql, params![user_id]).await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(PendingRequest {
            id: row.get(0)?,
            requester_id: row.get(1)?,
            status: row.get(2)?,
            created_at: row.get(3).unwrap_or_default(),
            requester: public_user_from_row(&row, 4)?,
        });
    }
    Ok(out)
}

#[derive(Debug)]
pub enum FriendError {
    SelfTarget(&'static str),
    NotFound(&'static str),
    Db(anyhow::Error),
}

impl From<libsql::Error> for FriendError {
    fn from(e: libsql::Error) -> Self {
        FriendError::Db(e.into())
    }
}

pub async fn send_friend_request(
    db: &Db,
    user_id: i64,
    target_user_id: i64,
) -> Result<(), FriendError> {
    if user_id == target_user_id {
        return Err(FriendError::SelfTarget(
            "Cannot send friend request to yourself",
        ));
    }
    let mut rows = db
        .conn()
        .query(
            "SELECT id, status FROM friends
             WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)",
            params![user_id, target_user_id, target_user_id, user_id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        let id: i64 = row.get(0)?;
        let status: String = row.get(1)?;
        // Accepted or already pending: nothing to do, and not an error.
        if status == "accepted" || status == "pending" {
            return Ok(());
        }
        // Re-request after a decline: the new requester becomes user_a.
        db.conn()
            .execute(
                "UPDATE friends SET user_a_id = ?, user_b_id = ?, status = 'pending',
                 updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                params![user_id, target_user_id, id],
            )
            .await?;
        return Ok(());
    }

    db.conn()
        .execute(
            "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (?, ?, 'pending')",
            params![user_id, target_user_id],
        )
        .await?;
    Ok(())
}

pub async fn respond_friend_request(
    db: &Db,
    friend_id: i64,
    user_id: i64,
    accept: bool,
) -> Result<String, FriendError> {
    let mut rows = db
        .conn()
        .query(
            "SELECT id FROM friends WHERE id = ? AND user_b_id = ? AND status = 'pending'",
            params![friend_id, user_id],
        )
        .await?;
    if rows.next().await?.is_none() {
        return Err(FriendError::NotFound("Friend request not found"));
    }
    let new_status = if accept { "accepted" } else { "declined" };
    db.conn()
        .execute(
            "UPDATE friends SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params![new_status, friend_id],
        )
        .await?;
    Ok(new_status.to_string())
}

pub async fn remove_friend(db: &Db, friend_id: i64, user_id: i64) -> anyhow::Result<()> {
    db.conn()
        .execute(
            "DELETE FROM friends WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)",
            params![friend_id, user_id, user_id],
        )
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

pub async fn follow_user(db: &Db, follower_id: i64, followed_id: i64) -> Result<(), FriendError> {
    if follower_id == followed_id {
        return Err(FriendError::SelfTarget("Cannot follow yourself"));
    }
    db.conn()
        .execute(
            "INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)",
            params![follower_id, followed_id],
        )
        .await?;
    Ok(())
}

pub async fn unfollow_user(db: &Db, follower_id: i64, followed_id: i64) -> anyhow::Result<()> {
    db.conn()
        .execute(
            "DELETE FROM follows WHERE follower_id = ? AND followed_id = ?",
            params![follower_id, followed_id],
        )
        .await?;
    Ok(())
}

pub struct FollowRow {
    pub id: i64,
    pub user_id: i64,
    pub user: PublicUser,
}

pub struct Follows {
    pub followers: Vec<FollowRow>,
    pub following: Vec<FollowRow>,
}

pub async fn get_follows(db: &Db, user_id: i64) -> anyhow::Result<Follows> {
    let followers = follow_side(
        db,
        user_id,
        &format!(
            "SELECT f.id, f.follower_id, {USER_COLS}
             FROM follows f JOIN users u ON u.id = f.follower_id
             WHERE f.followed_id = ? ORDER BY f.created_at DESC"
        ),
    )
    .await?;
    let following = follow_side(
        db,
        user_id,
        &format!(
            "SELECT f.id, f.followed_id, {USER_COLS}
             FROM follows f JOIN users u ON u.id = f.followed_id
             WHERE f.follower_id = ? ORDER BY f.created_at DESC"
        ),
    )
    .await?;
    Ok(Follows { followers, following })
}

async fn follow_side(db: &Db, user_id: i64, sql: &str) -> anyhow::Result<Vec<FollowRow>> {
    let mut rows = db.conn().query(sql, params![user_id]).await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(FollowRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            user: public_user_from_row(&row, 2)?,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

pub struct InvitationRow {
    pub id: i64,
    pub inviter_id: i64,
    pub room_id: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: String,
    pub inviter_user: PublicUser,
}

pub async fn get_invitations(db: &Db, user_id: i64) -> anyhow::Result<Vec<InvitationRow>> {
    let sql = format!(
        "SELECT i.id, i.inviter_id, i.room_id, i.status, i.created_at, i.expires_at, {USER_COLS}
         FROM invitations i
         JOIN users u ON u.id = i.inviter_id
         WHERE i.invitee_id = ? AND i.status = 'pending' AND i.expires_at > datetime('now')
         ORDER BY i.created_at DESC"
    );
    let mut rows = db.conn().query(&sql, params![user_id]).await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(InvitationRow {
            id: row.get(0)?,
            inviter_id: row.get(1)?,
            room_id: row.get(2)?,
            status: row.get(3)?,
            created_at: row.get(4).unwrap_or_default(),
            expires_at: row.get(5).unwrap_or_default(),
            inviter_user: public_user_from_row(&row, 6)?,
        });
    }
    Ok(out)
}

/// Invitations expire 30 minutes after they are sent.
pub async fn send_invitation(
    db: &Db,
    inviter_id: i64,
    invitee_id: i64,
    room_id: &str,
) -> Result<i64, FriendError> {
    if inviter_id == invitee_id {
        return Err(FriendError::SelfTarget("Cannot invite yourself"));
    }
    let expires_at = {
        use time::format_description::well_known::Rfc3339;
        (time::OffsetDateTime::now_utc() + time::Duration::minutes(30))
            .format(&Rfc3339)
            .unwrap_or_default()
    };
    db.conn()
        .execute(
            "INSERT OR REPLACE INTO invitations (inviter_id, invitee_id, room_id, status, expires_at)
             VALUES (?, ?, ?, 'pending', ?)",
            params![inviter_id, invitee_id, room_id, expires_at],
        )
        .await?;

    let mut rows = db
        .conn()
        .query(
            "SELECT id FROM invitations WHERE inviter_id = ? AND invitee_id = ? AND room_id = ? AND status = 'pending'",
            params![inviter_id, invitee_id, room_id],
        )
        .await?;
    Ok(match rows.next().await? {
        Some(row) => row.get(0).unwrap_or(0),
        None => 0,
    })
}

pub async fn respond_invitation(
    db: &Db,
    invitation_id: i64,
    invitee_id: i64,
    accept: bool,
) -> Result<String, FriendError> {
    let mut rows = db
        .conn()
        .query(
            "SELECT status FROM invitations WHERE id = ? AND invitee_id = ?",
            params![invitation_id, invitee_id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Err(FriendError::NotFound("Invitation not found"));
    };
    let status: String = row.get(0)?;
    let target = if accept { "accepted" } else { "declined" };

    // Responding twice the same way is idempotent; flipping a settled
    // invitation is not allowed.
    if status == target {
        return Ok(target.to_string());
    }
    if status != "pending" {
        return Err(FriendError::NotFound("Invitation already settled"));
    }
    db.conn()
        .execute(
            "UPDATE invitations SET status = ? WHERE id = ?",
            params![target, invitation_id],
        )
        .await?;
    Ok(target.to_string())
}

pub async fn cancel_invitation(db: &Db, invitation_id: i64, inviter_id: i64) -> anyhow::Result<()> {
    db.conn()
        .execute(
            "DELETE FROM invitations WHERE id = ? AND inviter_id = ?",
            params![invitation_id, inviter_id],
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded_db() -> Db {
        let db = Db::open(":memory:").await.expect("in-memory db");
        db.migrate().await.expect("migrate");
        for id in 1..=3 {
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
    async fn only_the_recipient_can_accept() {
        let db = seeded_db().await;
        send_friend_request(&db, 1, 2).await.unwrap();
        let pending = get_pending_friend_requests(&db, 2).await.unwrap();
        assert_eq!(pending.len(), 1);
        let id = pending[0].id;

        // The requester cannot accept their own request.
        assert!(matches!(
            respond_friend_request(&db, id, 1, true).await,
            Err(FriendError::NotFound(_))
        ));
        assert_eq!(respond_friend_request(&db, id, 2, true).await.unwrap(), "accepted");
    }

    #[tokio::test]
    async fn re_requesting_after_a_decline_swaps_the_requester() {
        let db = seeded_db().await;
        send_friend_request(&db, 1, 2).await.unwrap();
        let id = get_pending_friend_requests(&db, 2).await.unwrap()[0].id;
        respond_friend_request(&db, id, 2, false).await.unwrap();

        // Now the other direction: 2 asks 1, so 1 must be the one who accepts.
        send_friend_request(&db, 2, 1).await.unwrap();
        let pending = get_pending_friend_requests(&db, 1).await.unwrap();
        assert_eq!(pending.len(), 1, "the row is reused, not duplicated");
        assert_eq!(pending[0].requester_id, 2);
    }

    #[tokio::test]
    async fn duplicate_requests_are_idempotent() {
        let db = seeded_db().await;
        send_friend_request(&db, 1, 2).await.unwrap();
        send_friend_request(&db, 1, 2).await.unwrap();
        send_friend_request(&db, 2, 1).await.unwrap();
        assert_eq!(get_pending_friend_requests(&db, 2).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn self_targeting_is_refused_for_friends_and_follows() {
        let db = seeded_db().await;
        assert!(matches!(
            send_friend_request(&db, 1, 1).await,
            Err(FriendError::SelfTarget(_))
        ));
        assert!(matches!(
            follow_user(&db, 1, 1).await,
            Err(FriendError::SelfTarget(_))
        ));
        assert!(matches!(
            send_invitation(&db, 1, 1, "room").await,
            Err(FriendError::SelfTarget(_))
        ));
    }

    #[tokio::test]
    async fn follows_are_one_way_and_listed_from_both_sides() {
        let db = seeded_db().await;
        follow_user(&db, 1, 2).await.unwrap();
        follow_user(&db, 1, 2).await.unwrap(); // INSERT OR IGNORE

        let a = get_follows(&db, 1).await.unwrap();
        assert_eq!(a.following.len(), 1);
        assert!(a.followers.is_empty());

        let b = get_follows(&db, 2).await.unwrap();
        assert_eq!(b.followers.len(), 1);
        assert_eq!(b.followers[0].user.id, 1);

        unfollow_user(&db, 1, 2).await.unwrap();
        assert!(get_follows(&db, 1).await.unwrap().following.is_empty());
    }

    #[tokio::test]
    async fn an_invitation_cannot_be_flipped_once_settled() {
        let db = seeded_db().await;
        let id = send_invitation(&db, 1, 2, "room-1").await.unwrap();
        assert!(id > 0);
        assert_eq!(respond_invitation(&db, id, 2, true).await.unwrap(), "accepted");
        // Same answer twice is fine.
        assert_eq!(respond_invitation(&db, id, 2, true).await.unwrap(), "accepted");
        // The opposite answer is not.
        assert!(matches!(
            respond_invitation(&db, id, 2, false).await,
            Err(FriendError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn only_pending_unexpired_invitations_are_listed() {
        let db = seeded_db().await;
        send_invitation(&db, 1, 2, "room-1").await.unwrap();
        assert_eq!(get_invitations(&db, 2).await.unwrap().len(), 1);

        db.conn()
            .execute(
                "UPDATE invitations SET expires_at = '2000-01-01T00:00:00Z'",
                (),
            )
            .await
            .unwrap();
        assert!(
            get_invitations(&db, 2).await.unwrap().is_empty(),
            "expired invitations are hidden"
        );
    }
}

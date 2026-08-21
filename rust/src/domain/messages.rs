//! Direct messages and the relationship checks that gate them.
//! Port of `server/messages.ts`.

use libsql::params;

use crate::db::Db;
use crate::proto::{Message, RelationshipStatus};

pub const MAX_MESSAGE_LENGTH: usize = 500;

pub async fn are_friends(db: &Db, user_id: i64, other_id: i64) -> anyhow::Result<bool> {
    let mut rows = db
        .conn()
        .query(
            "SELECT 1 FROM friends
             WHERE (user_a_id = ? AND user_b_id = ? OR user_a_id = ? AND user_b_id = ?)
               AND status = 'accepted'",
            params![user_id, other_id, other_id, user_id],
        )
        .await?;
    Ok(rows.next().await?.is_some())
}

pub async fn is_following(db: &Db, follower_id: i64, followed_id: i64) -> anyhow::Result<bool> {
    let mut rows = db
        .conn()
        .query(
            "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?",
            params![follower_id, followed_id],
        )
        .await?;
    Ok(rows.next().await?.is_some())
}

/// Messaging is allowed between friends, in either follow direction, and with
/// yourself (the client uses self-messaging as a scratchpad).
pub async fn has_relationship(db: &Db, user_id: i64, other_id: i64) -> anyhow::Result<bool> {
    if user_id == other_id {
        return Ok(true);
    }
    if are_friends(db, user_id, other_id).await? {
        return Ok(true);
    }
    if is_following(db, user_id, other_id).await? {
        return Ok(true);
    }
    is_following(db, other_id, user_id).await
}

pub async fn get_relationship(
    db: &Db,
    user_id: i64,
    other_id: i64,
) -> anyhow::Result<RelationshipStatus> {
    if user_id == other_id {
        return Ok(RelationshipStatus::Friend);
    }
    if are_friends(db, user_id, other_id).await? {
        return Ok(RelationshipStatus::Friend);
    }
    if is_following(db, user_id, other_id).await? {
        return Ok(RelationshipStatus::Following);
    }
    if is_following(db, other_id, user_id).await? {
        return Ok(RelationshipStatus::Follower);
    }
    Ok(RelationshipStatus::None)
}

#[derive(Debug)]
pub enum SendError {
    NoRelationship,
    Db(anyhow::Error),
}

impl From<libsql::Error> for SendError {
    fn from(e: libsql::Error) -> Self {
        SendError::Db(e.into())
    }
}

pub async fn send_message(
    db: &Db,
    sender_id: i64,
    recipient_id: i64,
    text: &str,
) -> Result<Message, SendError> {
    if !has_relationship(db, sender_id, recipient_id)
        .await
        .map_err(SendError::Db)?
    {
        return Err(SendError::NoRelationship);
    }
    // `text.slice(0, 500)` counts UTF-16 units in JS; chars here. Both cut at
    // the same place for the BMP text this carries.
    let trimmed: String = text.chars().take(MAX_MESSAGE_LENGTH).collect();

    db.conn()
        .execute(
            "INSERT INTO messages (sender_id, recipient_id, text) VALUES (?, ?, ?)",
            params![sender_id, recipient_id, trimmed],
        )
        .await?;
    let id = db.conn().last_insert_rowid();

    let mut rows = db
        .conn()
        .query(
            "SELECT id, sender_id, recipient_id, text, created_at FROM messages WHERE id = ?",
            params![id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| SendError::Db(anyhow::anyhow!("inserted message vanished")))?;
    Ok(Message {
        id: row.get(0)?,
        sender_id: row.get(1)?,
        recipient_id: row.get(2)?,
        text: row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// Newest-first from SQL, reversed to oldest-first for the client — the order
/// the chat pane renders.
pub async fn get_conversation(
    db: &Db,
    user_id: i64,
    friend_id: i64,
    limit: i64,
    before_id: Option<i64>,
) -> anyhow::Result<Vec<Message>> {
    let sql = if before_id.is_some() {
        "SELECT m.id, m.sender_id, m.recipient_id, m.text, m.created_at
         FROM messages m
         WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
           AND m.id < ?
         ORDER BY m.id DESC
         LIMIT ?"
    } else {
        "SELECT m.id, m.sender_id, m.recipient_id, m.text, m.created_at
         FROM messages m
         WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
         ORDER BY m.id DESC
         LIMIT ?"
    };

    let mut rows = match before_id {
        Some(before) => {
            db.conn()
                .query(sql, params![user_id, friend_id, friend_id, user_id, before, limit])
                .await?
        }
        None => {
            db.conn()
                .query(sql, params![user_id, friend_id, friend_id, user_id, limit])
                .await?
        }
    };

    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(Message {
            id: row.get(0)?,
            sender_id: row.get(1)?,
            recipient_id: row.get(2)?,
            text: row.get(3)?,
            created_at: row.get(4)?,
        });
    }
    out.reverse();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded_db() -> Db {
        let db = Db::open(":memory:").await.expect("in-memory db");
        db.migrate().await.expect("migrate");
        for id in 1..=4 {
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
    async fn strangers_cannot_message_each_other() {
        let db = seeded_db().await;
        assert!(!has_relationship(&db, 1, 2).await.unwrap());
        assert!(matches!(
            send_message(&db, 1, 2, "hi").await,
            Err(SendError::NoRelationship)
        ));
    }

    #[tokio::test]
    async fn friends_follows_and_self_all_open_the_channel() {
        let db = seeded_db().await;
        // Self is always allowed.
        assert!(has_relationship(&db, 1, 1).await.unwrap());

        db.conn()
            .execute(
                "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (1, 2, 'accepted')",
                (),
            )
            .await
            .unwrap();
        assert!(has_relationship(&db, 1, 2).await.unwrap());
        assert!(has_relationship(&db, 2, 1).await.unwrap(), "friendship is mutual");

        // A follow in either direction is enough.
        db.conn()
            .execute("INSERT INTO follows (follower_id, followed_id) VALUES (3, 4)", ())
            .await
            .unwrap();
        assert!(has_relationship(&db, 3, 4).await.unwrap());
        assert!(has_relationship(&db, 4, 3).await.unwrap());
    }

    #[tokio::test]
    async fn a_pending_friend_request_is_not_yet_a_relationship() {
        let db = seeded_db().await;
        db.conn()
            .execute(
                "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (1, 2, 'pending')",
                (),
            )
            .await
            .unwrap();
        assert!(!are_friends(&db, 1, 2).await.unwrap());
        assert!(!has_relationship(&db, 1, 2).await.unwrap());
    }

    #[tokio::test]
    async fn relationship_status_distinguishes_the_follow_direction() {
        let db = seeded_db().await;
        assert_eq!(get_relationship(&db, 1, 1).await.unwrap(), RelationshipStatus::Friend);
        assert_eq!(get_relationship(&db, 1, 2).await.unwrap(), RelationshipStatus::None);

        db.conn()
            .execute("INSERT INTO follows (follower_id, followed_id) VALUES (1, 2)", ())
            .await
            .unwrap();
        assert_eq!(
            get_relationship(&db, 1, 2).await.unwrap(),
            RelationshipStatus::Following
        );
        assert_eq!(
            get_relationship(&db, 2, 1).await.unwrap(),
            RelationshipStatus::Follower
        );

        db.conn()
            .execute(
                "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (1, 2, 'accepted')",
                (),
            )
            .await
            .unwrap();
        assert_eq!(
            get_relationship(&db, 1, 2).await.unwrap(),
            RelationshipStatus::Friend,
            "friendship outranks a follow"
        );
    }

    #[tokio::test]
    async fn messages_are_truncated_and_returned_oldest_first() {
        let db = seeded_db().await;
        let long = "x".repeat(MAX_MESSAGE_LENGTH + 50);
        let sent = send_message(&db, 1, 1, &long).await.expect("self message");
        assert_eq!(sent.text.chars().count(), MAX_MESSAGE_LENGTH);

        send_message(&db, 1, 1, "second").await.unwrap();
        send_message(&db, 1, 1, "third").await.unwrap();

        let convo = get_conversation(&db, 1, 1, 50, None).await.unwrap();
        assert_eq!(convo.len(), 3);
        assert_eq!(convo[1].text, "second");
        assert_eq!(convo[2].text, "third", "oldest first");
    }

    #[tokio::test]
    async fn before_id_pages_backwards() {
        let db = seeded_db().await;
        for i in 0..5 {
            send_message(&db, 1, 1, &format!("m{i}")).await.unwrap();
        }
        let all = get_conversation(&db, 1, 1, 50, None).await.unwrap();
        let third_id = all[2].id;

        let page = get_conversation(&db, 1, 1, 50, Some(third_id)).await.unwrap();
        assert_eq!(page.len(), 2, "only messages before the cursor");
        assert!(page.iter().all(|m| m.id < third_id));
    }
}

//! Persistent groups: membership, messages and invites. Port of
//! `server/groups.ts`.

use libsql::{params, Row};

use crate::db::Db;
use crate::proto::{GroupMessage, PublicUser};

const MAX_GROUP_NAME: usize = 100;
const MAX_MESSAGE_LENGTH: usize = 500;

/// The joined user columns, in the order `public_user_from_row` expects.
const USER_COLS: &str = "u.id, u.email, u.birth_date, u.gender, u.country, u.language, u.interests, u.email_verified";

fn public_user_from_row(row: &Row, base: i32) -> PublicUser {
    let interests: Option<String> = row.get(base + 6).ok();
    PublicUser {
        id: row.get(base).unwrap_or(0),
        email: row.get(base + 1).unwrap_or_default(),
        birth_date: row.get(base + 2).ok(),
        gender: row
            .get::<String>(base + 3)
            .ok()
            .and_then(|g| match g.as_str() {
                "any" => Some(crate::proto::Gender::Any),
                "male" => Some(crate::proto::Gender::Male),
                "female" => Some(crate::proto::Gender::Female),
                "other" => Some(crate::proto::Gender::Other),
                _ => None,
            }),
        country: row.get(base + 4).ok(),
        language: row.get(base + 5).ok(),
        interests: interests.and_then(|s| serde_json::from_str(&s).ok()),
        email_verified: row.get::<i64>(base + 7).ok().map(|v| v != 0),
    }
}

#[derive(Debug)]
pub enum GroupError {
    NotFound(&'static str),
    Forbidden(&'static str),
    Invalid(&'static str),
    Db(anyhow::Error),
}

impl From<libsql::Error> for GroupError {
    fn from(e: libsql::Error) -> Self {
        GroupError::Db(e.into())
    }
}

type GroupResult<T> = Result<T, GroupError>;

pub struct Group {
    pub id: i64,
    pub name: String,
    pub created_by: i64,
    pub created_at: String,
    pub my_role: String,
    pub member_count: i64,
}

pub struct GroupMember {
    pub id: i64,
    pub group_id: i64,
    pub user_id: i64,
    pub role: String,
    pub joined_at: String,
    pub user: PublicUser,
}

const GROUP_SELECT: &str = "SELECT g.id, g.name, g.created_by, g.created_at, gm.role,
     (SELECT COUNT(*) FROM group_members WHERE group_id = g.id)
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?";

fn group_from_row(row: &Row) -> GroupResult<Group> {
    Ok(Group {
        id: row.get(0)?,
        name: row.get(1)?,
        created_by: row.get(2)?,
        created_at: row.get(3).unwrap_or_default(),
        my_role: row.get(4).unwrap_or_default(),
        member_count: row.get(5).unwrap_or(0),
    })
}

pub async fn get_groups(db: &Db, user_id: i64) -> GroupResult<Vec<Group>> {
    let sql = format!("{GROUP_SELECT} ORDER BY g.created_at DESC");
    let mut rows = db.conn().query(&sql, params![user_id]).await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(group_from_row(&row)?);
    }
    Ok(out)
}

/// Returns `None` when the group does not exist OR the caller is not a member —
/// the join makes those indistinguishable, which is also what hides other
/// people's groups.
pub async fn get_group(db: &Db, group_id: i64, user_id: i64) -> GroupResult<Option<Group>> {
    let sql = format!("{GROUP_SELECT} WHERE g.id = ?");
    let mut rows = db.conn().query(&sql, params![user_id, group_id]).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(group_from_row(&row)?)),
        None => Ok(None),
    }
}

pub async fn get_group_members(db: &Db, group_id: i64) -> GroupResult<Vec<GroupMember>> {
    let sql = format!(
        "SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.joined_at, {USER_COLS}
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?
         ORDER BY gm.joined_at ASC"
    );
    let mut rows = db.conn().query(&sql, params![group_id]).await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(GroupMember {
            id: row.get(0)?,
            group_id: row.get(1)?,
            user_id: row.get(2)?,
            role: row.get(3).unwrap_or_default(),
            joined_at: row.get(4).unwrap_or_default(),
            user: public_user_from_row(&row, 5),
        });
    }
    Ok(out)
}

pub async fn create_group(
    db: &Db,
    creator_id: i64,
    name: &str,
    member_ids: &[i64],
) -> GroupResult<(Option<Group>, Vec<GroupMember>)> {
    let trimmed: String = name.trim().chars().take(MAX_GROUP_NAME).collect();
    if trimmed.is_empty() {
        return Err(GroupError::Invalid("Group name is required"));
    }
    db.conn()
        .execute(
            "INSERT INTO groups (name, created_by) VALUES (?, ?)",
            params![trimmed, creator_id],
        )
        .await?;
    let group_id = db.conn().last_insert_rowid();

    db.conn()
        .execute(
            "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')",
            params![group_id, creator_id],
        )
        .await?;
    for member_id in member_ids {
        if *member_id == creator_id {
            continue;
        }
        db.conn()
            .execute(
                "INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
                params![group_id, *member_id],
            )
            .await?;
    }

    Ok((
        get_group(db, group_id, creator_id).await?,
        get_group_members(db, group_id).await?,
    ))
}

async fn require_admin(db: &Db, group_id: i64, user_id: i64, what: &'static str) -> GroupResult<Group> {
    let group = get_group(db, group_id, user_id)
        .await?
        .ok_or(GroupError::NotFound("Group not found"))?;
    if group.my_role != "admin" {
        return Err(GroupError::Forbidden(what));
    }
    Ok(group)
}

pub async fn rename_group(db: &Db, group_id: i64, user_id: i64, new_name: &str) -> GroupResult<()> {
    require_admin(db, group_id, user_id, "Only admin can rename the group").await?;
    let trimmed: String = new_name.trim().chars().take(MAX_GROUP_NAME).collect();
    if trimmed.is_empty() {
        return Err(GroupError::Invalid("Group name is required"));
    }
    db.conn()
        .execute("UPDATE groups SET name = ? WHERE id = ?", params![trimmed, group_id])
        .await?;
    Ok(())
}

pub async fn add_group_members(
    db: &Db,
    group_id: i64,
    user_id: i64,
    new_member_ids: &[i64],
) -> GroupResult<()> {
    require_admin(db, group_id, user_id, "Only admin can add members").await?;
    for member_id in new_member_ids {
        if *member_id == user_id {
            continue;
        }
        db.conn()
            .execute(
                "INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
                params![group_id, *member_id],
            )
            .await?;
    }
    Ok(())
}

pub async fn remove_group_member(
    db: &Db,
    group_id: i64,
    user_id: i64,
    target_user_id: i64,
) -> GroupResult<()> {
    let group = get_group(db, group_id, user_id)
        .await?
        .ok_or(GroupError::NotFound("Group not found"))?;

    if user_id == target_user_id {
        // Removing yourself is the older, stricter path: the last admin is
        // refused here. `leave_group` is the one that hands the role over.
        if group.my_role == "admin" {
            let members = get_group_members(db, group_id).await?;
            let other_admins = members
                .iter()
                .filter(|m| m.role == "admin" && m.user_id != user_id)
                .count();
            if other_admins == 0 {
                return Err(GroupError::Forbidden("Cannot leave group with no other admins"));
            }
        }
    } else if group.my_role != "admin" {
        return Err(GroupError::Forbidden("Only admin can remove members"));
    }

    let target = if user_id == target_user_id { user_id } else { target_user_id };
    db.conn()
        .execute(
            "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
            params![group_id, target],
        )
        .await?;
    Ok(())
}

pub struct LeaveOutcome {
    pub dissolved: bool,
}

/// Leaving hands the admin role to the next-oldest member rather than refusing
/// the last admin (which used to leave them stuck in the group), and a group
/// nobody is left in is deleted outright.
pub async fn leave_group(db: &Db, group_id: i64, user_id: i64) -> GroupResult<LeaveOutcome> {
    let group = get_group(db, group_id, user_id)
        .await?
        .ok_or(GroupError::NotFound("Group not found"))?;

    let members = get_group_members(db, group_id).await?;
    let others: Vec<&GroupMember> = members.iter().filter(|m| m.user_id != user_id).collect();

    db.conn()
        .execute(
            "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
            params![group_id, user_id],
        )
        .await?;

    if others.is_empty() {
        // Explicit cleanup: SQLite only cascades when foreign keys are enabled.
        for sql in [
            "DELETE FROM group_messages WHERE group_id = ?",
            "DELETE FROM group_invites WHERE group_id = ?",
            "DELETE FROM groups WHERE id = ?",
        ] {
            db.conn().execute(sql, params![group_id]).await?;
        }
        return Ok(LeaveOutcome { dissolved: true });
    }

    if group.my_role == "admin" && !others.iter().any(|m| m.role == "admin") {
        // `others` is ordered by joined_at, so this is the longest-standing member.
        let successor = others[0];
        db.conn()
            .execute(
                "UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?",
                params![group_id, successor.user_id],
            )
            .await?;
    }

    Ok(LeaveOutcome { dissolved: false })
}

pub async fn is_group_member(db: &Db, group_id: i64, user_id: i64) -> GroupResult<bool> {
    let mut rows = db
        .conn()
        .query(
            "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?",
            params![group_id, user_id],
        )
        .await?;
    Ok(rows.next().await?.is_some())
}

pub async fn send_group_message(
    db: &Db,
    group_id: i64,
    sender_id: i64,
    text: &str,
) -> GroupResult<GroupMessage> {
    if !is_group_member(db, group_id, sender_id).await? {
        return Err(GroupError::Forbidden("Not a group member"));
    }
    let trimmed: String = text.chars().take(MAX_MESSAGE_LENGTH).collect();
    db.conn()
        .execute(
            "INSERT INTO group_messages (group_id, sender_id, text) VALUES (?, ?, ?)",
            params![group_id, sender_id, trimmed],
        )
        .await?;
    let id = db.conn().last_insert_rowid();

    let mut rows = db
        .conn()
        .query(
            "SELECT id, group_id, sender_id, text, created_at FROM group_messages WHERE id = ?",
            params![id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or(GroupError::NotFound("Message vanished"))?;
    Ok(GroupMessage {
        id: row.get(0)?,
        group_id: row.get(1)?,
        sender_id: row.get(2)?,
        text: row.get(3)?,
        created_at: row.get(4).unwrap_or_default(),
        sender: None,
    })
}

pub async fn get_group_messages(
    db: &Db,
    group_id: i64,
    user_id: i64,
    limit: i64,
    before_id: Option<i64>,
) -> GroupResult<Vec<GroupMessage>> {
    if !is_group_member(db, group_id, user_id).await? {
        return Err(GroupError::Forbidden("Not a group member"));
    }
    let before_clause = if before_id.is_some() { "AND gm.id < ?" } else { "" };
    let sql = format!(
        "SELECT gm.id, gm.group_id, gm.sender_id, gm.text, gm.created_at, {USER_COLS}
         FROM group_messages gm
         JOIN users u ON u.id = gm.sender_id
         WHERE gm.group_id = ? {before_clause}
         ORDER BY gm.id DESC
         LIMIT ?"
    );
    let mut rows = match before_id {
        Some(before) => db.conn().query(&sql, params![group_id, before, limit]).await?,
        None => db.conn().query(&sql, params![group_id, limit]).await?,
    };

    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(GroupMessage {
            id: row.get(0)?,
            group_id: row.get(1)?,
            sender_id: row.get(2)?,
            text: row.get(3)?,
            created_at: row.get(4).unwrap_or_default(),
            sender: Some(public_user_from_row(&row, 5)),
        });
    }
    out.reverse();
    Ok(out)
}

pub struct GroupInvite {
    pub id: i64,
    pub group_id: i64,
    pub inviter_id: i64,
    pub invitee_id: i64,
    pub status: String,
    pub created_at: String,
    pub group_name: String,
    pub inviter_user: Option<PublicUser>,
}

pub async fn send_group_invite(
    db: &Db,
    group_id: i64,
    inviter_id: i64,
    invitee_id: i64,
) -> GroupResult<GroupInvite> {
    if inviter_id == invitee_id {
        return Err(GroupError::Invalid("Cannot invite yourself"));
    }
    let group = get_group(db, group_id, inviter_id)
        .await?
        .ok_or(GroupError::NotFound("Group not found"))?;
    if is_group_member(db, group_id, invitee_id).await? {
        return Err(GroupError::Invalid("Already a member"));
    }
    db.conn()
        .execute(
            "INSERT OR REPLACE INTO group_invites (group_id, inviter_id, invitee_id, status)
             VALUES (?, ?, ?, 'pending')",
            params![group_id, inviter_id, invitee_id],
        )
        .await?;

    let mut rows = db
        .conn()
        .query(
            "SELECT id, group_id, inviter_id, invitee_id, status, created_at
             FROM group_invites WHERE group_id = ? AND invitee_id = ?",
            params![group_id, invitee_id],
        )
        .await?;
    let row = rows.next().await?.ok_or(GroupError::NotFound("Invite vanished"))?;
    Ok(GroupInvite {
        id: row.get(0)?,
        group_id: row.get(1)?,
        inviter_id: row.get(2)?,
        invitee_id: row.get(3)?,
        status: row.get(4).unwrap_or_default(),
        created_at: row.get(5).unwrap_or_default(),
        group_name: group.name,
        inviter_user: None,
    })
}

pub struct InviteResponse {
    pub group_id: i64,
    pub inviter_id: i64,
}

pub async fn respond_group_invite(
    db: &Db,
    invite_id: i64,
    user_id: i64,
    accept: bool,
) -> GroupResult<InviteResponse> {
    let mut rows = db
        .conn()
        .query(
            "SELECT group_id, inviter_id FROM group_invites
             WHERE id = ? AND invitee_id = ? AND status = 'pending'",
            params![invite_id, user_id],
        )
        .await?;
    let row = rows.next().await?.ok_or(GroupError::NotFound("Invite not found"))?;
    let group_id: i64 = row.get(0)?;
    let inviter_id: i64 = row.get(1)?;

    if accept {
        db.conn()
            .execute(
                "INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
                params![group_id, user_id],
            )
            .await?;
    }
    db.conn()
        .execute(
            "UPDATE group_invites SET status = ? WHERE id = ?",
            params![if accept { "accepted" } else { "declined" }, invite_id],
        )
        .await?;

    Ok(InviteResponse { group_id, inviter_id })
}

pub async fn get_group_invites(db: &Db, user_id: i64) -> GroupResult<Vec<GroupInvite>> {
    let sql = format!(
        "SELECT gi.id, gi.group_id, gi.inviter_id, gi.invitee_id, gi.status, gi.created_at,
                g.name, {USER_COLS}
         FROM group_invites gi
         JOIN groups g ON g.id = gi.group_id
         JOIN users u ON u.id = gi.inviter_id
         WHERE gi.invitee_id = ? AND gi.status = 'pending'
         ORDER BY gi.created_at DESC"
    );
    let mut rows = db.conn().query(&sql, params![user_id]).await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(GroupInvite {
            id: row.get(0)?,
            group_id: row.get(1)?,
            inviter_id: row.get(2)?,
            invitee_id: row.get(3)?,
            status: row.get(4).unwrap_or_default(),
            created_at: row.get(5).unwrap_or_default(),
            group_name: row.get(6).unwrap_or_default(),
            inviter_user: Some(public_user_from_row(&row, 7)),
        });
    }
    Ok(out)
}

pub async fn get_group_invite(db: &Db, invite_id: i64) -> GroupResult<Option<GroupInvite>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT gi.id, gi.group_id, gi.inviter_id, gi.invitee_id, gi.status, gi.created_at, g.name
             FROM group_invites gi
             JOIN groups g ON g.id = gi.group_id
             WHERE gi.id = ?",
            params![invite_id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    Ok(Some(GroupInvite {
        id: row.get(0)?,
        group_id: row.get(1)?,
        inviter_id: row.get(2)?,
        invitee_id: row.get(3)?,
        status: row.get(4).unwrap_or_default(),
        created_at: row.get(5).unwrap_or_default(),
        group_name: row.get(6).unwrap_or_default(),
        inviter_user: None,
    }))
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
    async fn the_creator_is_admin_and_members_are_added() {
        let db = seeded_db().await;
        let (group, members) = create_group(&db, 1, "  Team  ", &[2, 3, 1]).await.unwrap();
        let group = group.expect("creator sees the group");
        assert_eq!(group.name, "Team", "name is trimmed");
        assert_eq!(group.my_role, "admin");
        assert_eq!(group.member_count, 3, "the duplicate creator id is skipped");
        assert_eq!(members.len(), 3);
    }

    #[tokio::test]
    async fn a_blank_name_is_refused() {
        let db = seeded_db().await;
        assert!(matches!(
            create_group(&db, 1, "   ", &[]).await,
            Err(GroupError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn non_members_cannot_see_or_post_to_a_group() {
        let db = seeded_db().await;
        let (group, _) = create_group(&db, 1, "Team", &[2]).await.unwrap();
        let gid = group.unwrap().id;

        assert!(get_group(&db, gid, 4).await.unwrap().is_none());
        assert!(matches!(
            send_group_message(&db, gid, 4, "hi").await,
            Err(GroupError::Forbidden(_))
        ));
        assert!(matches!(
            get_group_messages(&db, gid, 4, 50, None).await,
            Err(GroupError::Forbidden(_))
        ));
    }

    #[tokio::test]
    async fn only_admins_rename_and_add_members() {
        let db = seeded_db().await;
        let (group, _) = create_group(&db, 1, "Team", &[2]).await.unwrap();
        let gid = group.unwrap().id;

        assert!(matches!(
            rename_group(&db, gid, 2, "Nope").await,
            Err(GroupError::Forbidden(_))
        ));
        assert!(matches!(
            add_group_members(&db, gid, 2, &[3]).await,
            Err(GroupError::Forbidden(_))
        ));
        rename_group(&db, gid, 1, "Renamed").await.unwrap();
        assert_eq!(get_group(&db, gid, 1).await.unwrap().unwrap().name, "Renamed");
    }

    /// The behaviour the integration suite asserts: the last admin hands the
    /// role over instead of being stuck, and the last member dissolves it.
    #[tokio::test]
    async fn leaving_hands_over_admin_then_dissolves() {
        let db = seeded_db().await;
        let (group, _) = create_group(&db, 1, "Team", &[2]).await.unwrap();
        let gid = group.unwrap().id;

        let out = leave_group(&db, gid, 1).await.unwrap();
        assert!(!out.dissolved);
        let promoted = get_group(&db, gid, 2).await.unwrap().expect("member remains");
        assert_eq!(promoted.my_role, "admin", "the role is handed over");

        let out = leave_group(&db, gid, 2).await.unwrap();
        assert!(out.dissolved);
        assert!(get_group(&db, gid, 2).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn invites_cannot_target_yourself_or_an_existing_member() {
        let db = seeded_db().await;
        let (group, _) = create_group(&db, 1, "Team", &[2]).await.unwrap();
        let gid = group.unwrap().id;

        assert!(matches!(
            send_group_invite(&db, gid, 1, 1).await,
            Err(GroupError::Invalid(_))
        ));
        assert!(matches!(
            send_group_invite(&db, gid, 1, 2).await,
            Err(GroupError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn accepting_an_invite_joins_the_group_once() {
        let db = seeded_db().await;
        let (group, _) = create_group(&db, 1, "Team", &[]).await.unwrap();
        let gid = group.unwrap().id;

        let invite = send_group_invite(&db, gid, 1, 3).await.unwrap();
        assert_eq!(invite.group_name, "Team");
        assert_eq!(get_group_invites(&db, 3).await.unwrap().len(), 1);

        respond_group_invite(&db, invite.id, 3, true).await.unwrap();
        assert!(is_group_member(&db, gid, 3).await.unwrap());
        assert!(get_group_invites(&db, 3).await.unwrap().is_empty());

        // A settled invite cannot be replayed.
        assert!(matches!(
            respond_group_invite(&db, invite.id, 3, true).await,
            Err(GroupError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn group_messages_come_back_oldest_first_with_their_sender() {
        let db = seeded_db().await;
        let (group, _) = create_group(&db, 1, "Team", &[2]).await.unwrap();
        let gid = group.unwrap().id;

        send_group_message(&db, gid, 1, "first").await.unwrap();
        send_group_message(&db, gid, 2, "second").await.unwrap();

        let msgs = get_group_messages(&db, gid, 1, 50, None).await.unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].text, "first");
        assert_eq!(msgs[1].sender.as_ref().unwrap().id, 2);
    }
}

//! Embeddable minigames ("activities"): catalog, group-bound instances, and the
//! user-info-only login the iframe uses.
//!
//! Trust model, mirroring Discord's authorize-then-exchange flow: the host app
//! (full session) launches or joins and receives a single-use launch code; the
//! game exchanges the code for an instance-scoped token that only proves
//! identity inside that instance. Instance tokens live in their own table and
//! are the ONLY credential the game endpoints accept — a session cookie or
//! legacy Bearer [REDACTED] never resolves there, by table separation.

use libsql::params;

use crate::auth::password::{hash_token, random_token};
use crate::auth::session::{public_user, user_from_id};
use crate::db::Db;
use crate::domain::groups;
use crate::proto::{ActivityEntry, ActivityInstance, ActivityParticipantEntry, ActivityStatus};

/// Active games allowed per group at once; the WS fan-out is per instance.
const MAX_ACTIVE_INSTANCES_PER_GROUP: i64 = 3;
const LAUNCH_CODE_TTL_MINUTES: i64 = 5;
const INSTANCE_TOKEN_TTL_HOURS: i64 = 24;

fn iso_in(minutes: i64) -> String {
    use time::format_description::well_known::Rfc3339;
    let at = time::OffsetDateTime::now_utc() + time::Duration::minutes(minutes);
    at.format(&Rfc3339).unwrap_or_default()
}

fn expired(expires_at: &str) -> bool {
    // Both sides are UTC RFC3339 from `iso_in`, so lexicographic order is
    // chronological order — the same trick the session table relies on.
    iso_in(0).as_str() > expires_at
}

#[derive(Debug)]
pub enum ActivityError {
    NotFound(&'static str),
    Forbidden(&'static str),
    Invalid(&'static str),
    Db(anyhow::Error),
}

impl From<libsql::Error> for ActivityError {
    fn from(e: libsql::Error) -> Self {
        ActivityError::Db(e.into())
    }
}

type ActivityResult<T> = Result<T, ActivityError>;

/// Identity proven by an instance token: which user, inside which instance.
pub struct InstanceIdentity {
    pub instance_id: i64,
    pub user_id: i64,
}

fn entry_from_row(row: &libsql::Row) -> ActivityResult<ActivityEntry> {
    Ok(ActivityEntry {
        id: row.get(0)?,
        slug: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3).ok().filter(|s: &String| !s.is_empty()),
        entry_url: row.get(4)?,
        max_players: row.get(5)?,
    })
}

fn instance_from_row(row: &libsql::Row) -> ActivityResult<ActivityInstance> {
    let status: String = row.get(4).unwrap_or_default();
    Ok(ActivityInstance {
        id: row.get(0)?,
        activity_id: row.get(1)?,
        group_id: row.get(2)?,
        created_by: row.get(3)?,
        status: if status == "ended" {
            ActivityStatus::Ended
        } else {
            ActivityStatus::Active
        },
        created_at: row.get(5).unwrap_or_default(),
        ended_at: row.get(6).ok().filter(|s: &String| !s.is_empty()),
    })
}

pub async fn list_activities(db: &Db) -> ActivityResult<Vec<ActivityEntry>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT id, slug, name, description, entry_url, max_players
             FROM activities WHERE enabled = 1 ORDER BY name ASC",
            (),
        )
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(entry_from_row(&row)?);
    }
    Ok(out)
}

pub async fn get_activity(db: &Db, activity_id: i64) -> ActivityResult<Option<ActivityEntry>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT id, slug, name, description, entry_url, max_players
             FROM activities WHERE id = ? AND enabled = 1",
            params![activity_id],
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(entry_from_row(&row)?)),
        None => Ok(None),
    }
}

pub async fn get_instance(db: &Db, instance_id: i64) -> ActivityResult<Option<ActivityInstance>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT id, activity_id, group_id, created_by, status, created_at, ended_at
             FROM activity_instances WHERE id = ?",
            params![instance_id],
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(instance_from_row(&row)?)),
        None => Ok(None),
    }
}

/// Active instances in a group. Non-members see nothing (`get_group` returns
/// `None` for them, so the roster never leaks across groups).
pub async fn active_instances_for_group(
    db: &Db,
    group_id: i64,
    user_id: i64,
) -> ActivityResult<Vec<ActivityInstance>> {
    if groups::get_group(db, group_id, user_id)
        .await
        .map_err(|e| match e {
            groups::GroupError::Db(err) => ActivityError::Db(err),
            groups::GroupError::NotFound(m)
            | groups::GroupError::Forbidden(m)
            | groups::GroupError::Invalid(m) => ActivityError::Forbidden(m),
        })?
        .is_none()
    {
        return Err(ActivityError::Forbidden("Not a group member"));
    }
    let mut rows = db
        .conn()
        .query(
            "SELECT id, activity_id, group_id, created_by, status, created_at, ended_at
             FROM activity_instances
             WHERE group_id = ? AND status = 'active' ORDER BY created_at ASC",
            params![group_id],
        )
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(instance_from_row(&row)?);
    }
    Ok(out)
}

pub async fn launch_instance(
    db: &Db,
    activity_id: i64,
    group_id: i64,
    user_id: i64,
) -> ActivityResult<ActivityInstance> {
    let activity = get_activity(db, activity_id)
        .await?
        .ok_or(ActivityError::NotFound("Activity not found"))?;
    if groups::get_group(db, group_id, user_id)
        .await
        .map_err(|e| match e {
            groups::GroupError::Db(err) => ActivityError::Db(err),
            groups::GroupError::NotFound(m)
            | groups::GroupError::Forbidden(m)
            | groups::GroupError::Invalid(m) => ActivityError::Forbidden(m),
        })?
        .is_none()
    {
        return Err(ActivityError::Forbidden("Not a group member"));
    }
    let active: i64 = count_active(db, group_id).await?;
    if active >= MAX_ACTIVE_INSTANCES_PER_GROUP {
        return Err(ActivityError::Invalid("Too many active games in this group"));
    }
    db.conn()
        .execute(
            "INSERT INTO activity_instances (activity_id, group_id, created_by) VALUES (?, ?, ?)",
            params![activity.id, group_id, user_id],
        )
        .await?;
    let instance_id = db.conn().last_insert_rowid();
    db.conn()
        .execute(
            "INSERT OR IGNORE INTO activity_participants (instance_id, user_id) VALUES (?, ?)",
            params![instance_id, user_id],
        )
        .await?;
    get_instance(db, instance_id)
        .await?
        .ok_or(ActivityError::NotFound("Activity not found"))
}

async fn count_active(db: &Db, group_id: i64) -> ActivityResult<i64> {
    let mut rows = db
        .conn()
        .query(
            "SELECT COUNT(*) FROM activity_instances WHERE group_id = ? AND status = 'active'",
            params![group_id],
        )
        .await?;
    Ok(match rows.next().await? {
        Some(row) => row.get(0).unwrap_or(0),
        None => 0,
    })
}

/// Join an instance and mint a single-use launch code the iframe exchanges
/// for its instance token. Re-joining is seat-idempotent and mints an
/// additional code; outstanding codes stay spendable (each is single-use,
/// and expiry sweeps the table).
pub async fn join_instance(
    db: &Db,
    instance_id: i64,
    user_id: i64,
) -> ActivityResult<String> {
    let instance = get_instance(db, instance_id)
        .await?
        .ok_or(ActivityError::NotFound("Game not found"))?;
    if instance.status != ActivityStatus::Active {
        return Err(ActivityError::Invalid("That game has ended"));
    }
    if groups::get_group(db, instance.group_id, user_id)
        .await
        .map_err(|e| match e {
            groups::GroupError::Db(err) => ActivityError::Db(err),
            groups::GroupError::NotFound(m)
            | groups::GroupError::Forbidden(m)
            | groups::GroupError::Invalid(m) => ActivityError::Forbidden(m),
        })?
        .is_none()
    {
        return Err(ActivityError::Forbidden("Not a group member"));
    }
    db.conn()
        .execute(
            "INSERT OR IGNORE INTO activity_participants (instance_id, user_id) VALUES (?, ?)",
            params![instance_id, user_id],
        )
        .await?;
    let activity = get_activity(db, instance.activity_id)
        .await?
        .ok_or(ActivityError::NotFound("Activity not found"))?;
    let seats: i64 = participant_count(db, instance_id).await?;
    if seats > activity.max_players {
        db.conn()
            .execute(
                "DELETE FROM activity_participants WHERE instance_id = ? AND user_id = ?",
                params![instance_id, user_id],
            )
            .await?;
        return Err(ActivityError::Invalid("That game is full"));
    }
    // Best-effort hygiene so the codes table cannot grow without bound.
    // Only EXPIRED codes are swept: outstanding codes are never revoked
    // early, because the host mints one per `ready` (retries and reloads are
    // indistinguishable) and every delivered code must stay spendable.
    let _ = db
        .conn()
        .execute(
            "DELETE FROM activity_launch_codes WHERE instance_id = ? AND user_id = ? AND expires_at < ?",
            params![instance_id, user_id, iso_in(0)],
        )
        .await;
    let code = random_token();
    db.conn()
        .execute(
            "INSERT INTO activity_launch_codes (code_hash, instance_id, user_id, expires_at)
             VALUES (?, ?, ?, ?)",
            params![
                hash_token(&code),
                instance_id,
                user_id,
                iso_in(LAUNCH_CODE_TTL_MINUTES)
            ],
        )
        .await?;
    Ok(code)
}

async fn participant_count(db: &Db, instance_id: i64) -> ActivityResult<i64> {
    let mut rows = db
        .conn()
        .query(
            "SELECT COUNT(*) FROM activity_participants WHERE instance_id = ?",
            params![instance_id],
        )
        .await?;
    Ok(match rows.next().await? {
        Some(row) => row.get(0).unwrap_or(0),
        None => 0,
    })
}

/// Exchange a launch code for an instance token. The code is single-use and
/// bound to its instance; anything else fails closed with no detail.
pub async fn exchange_code(
    db: &Db,
    instance_id: i64,
    code: &str,
) -> ActivityResult<(String, i64)> {
    let mut rows = db
        .conn()
        .query(
            "SELECT instance_id, user_id, expires_at, used FROM activity_launch_codes WHERE code_hash = ?",
            params![hash_token(code)],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Err(ActivityError::Invalid("Invalid or expired code"));
    };
    let row_instance: i64 = row.get(0).unwrap_or(0);
    let user_id: i64 = row.get(1).unwrap_or(0);
    let expires_at: String = row.get(2).unwrap_or_default();
    let used: i64 = row.get(3).unwrap_or(1);
    if row_instance != instance_id || used != 0 || expired(&expires_at) {
        return Err(ActivityError::Invalid("Invalid or expired code"));
    }
    let instance = get_instance(db, instance_id)
        .await?
        .ok_or(ActivityError::Invalid("Invalid or expired code"))?;
    if instance.status != ActivityStatus::Active {
        return Err(ActivityError::Invalid("Invalid or expired code"));
    }
    db.conn()
        .execute(
            "UPDATE activity_launch_codes SET used = 1 WHERE code_hash = ?",
            params![hash_token(code)],
        )
        .await?;
    let token = random_token();
    db.conn()
        .execute(
            "INSERT INTO activity_tokens (token_hash, instance_id, user_id, expires_at)
             VALUES (?, ?, ?, ?)",
            params![
                hash_token(&token),
                instance_id,
                user_id,
                iso_in(INSTANCE_TOKEN_TTL_HOURS * 60)
            ],
        )
        .await?;
    Ok((token, user_id))
}

/// Resolve an instance token to its identity. ONLY the activity_tokens table
/// is consulted: session cookies and legacy Bearer [REDACTED] resolve to
/// nothing here, which is what keeps the iframe user-info-only. Expiry, an
/// ended instance, or a departed participant all fail closed.
pub async fn instance_token_identity(
    db: &Db,
    token: &str,
) -> ActivityResult<Option<InstanceIdentity>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT instance_id, user_id, expires_at FROM activity_tokens WHERE token_hash = ?",
            params![hash_token(token)],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    let instance_id: i64 = row.get(0).unwrap_or(0);
    let user_id: i64 = row.get(1).unwrap_or(0);
    let expires_at: String = row.get(2).unwrap_or_default();
    if instance_id == 0 || user_id == 0 || expired(&expires_at) {
        return Ok(None);
    }
    let Some(instance) = get_instance(db, instance_id).await? else {
        return Ok(None);
    };
    if instance.status != ActivityStatus::Active {
        return Ok(None);
    }
    if !is_participant(db, instance_id, user_id).await? {
        return Ok(None);
    }
    Ok(Some(InstanceIdentity {
        instance_id,
        user_id,
    }))
}

/// Participant ids for WS fan-out. Profiles are not needed on the hot
/// state-relay path, so this stays a single cheap query.
pub async fn participant_ids(db: &Db, instance_id: i64) -> ActivityResult<Vec<i64>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT user_id FROM activity_participants WHERE instance_id = ?",
            params![instance_id],
        )
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        let user_id: i64 = row.get(0)?;
        out.push(user_id);
    }
    Ok(out)
}

pub async fn is_participant(db: &Db, instance_id: i64, user_id: i64) -> ActivityResult<bool> {
    let mut rows = db
        .conn()
        .query(
            "SELECT 1 FROM activity_participants WHERE instance_id = ? AND user_id = ?",
            params![instance_id, user_id],
        )
        .await?;
    Ok(rows.next().await?.is_some())
}

/// Presence roster for an instance. Rosters are tiny (bounded by max_players),
/// so one profile lookup per seat is fine and reuses the tested converter.
pub async fn instance_participants(
    db: &Db,
    instance_id: i64,
) -> ActivityResult<Vec<ActivityParticipantEntry>> {
    let mut rows = db
        .conn()
        .query(
            "SELECT user_id, joined_at FROM activity_participants
             WHERE instance_id = ? ORDER BY joined_at ASC",
            params![instance_id],
        )
        .await?;
    let mut seats = Vec::new();
    while let Some(row) = rows.next().await? {
        let user_id: i64 = row.get(0)?;
        let joined_at: String = row.get(1).unwrap_or_default();
        seats.push((user_id, joined_at));
    }
    let mut out = Vec::new();
    for (user_id, joined_at) in seats {
        let row = user_from_id(db, user_id)
            .await
            .map_err(ActivityError::Db)?
            .ok_or(ActivityError::NotFound("Game not found"))?;
        out.push(ActivityParticipantEntry {
            user_id,
            user: public_user(&row),
            joined_at,
        });
    }
    Ok(out)
}

/// Leave an instance; the last seat out ends the game and revokes its tokens.
pub async fn leave_instance(
    db: &Db,
    instance_id: i64,
    user_id: i64,
) -> ActivityResult<bool> {
    revoke_user_tokens(db, instance_id, user_id).await?;
    db.conn()
        .execute(
            "DELETE FROM activity_launch_codes WHERE instance_id = ? AND user_id = ?",
            params![instance_id, user_id],
        )
        .await?;
    db.conn()
        .execute(
            "DELETE FROM activity_participants WHERE instance_id = ? AND user_id = ?",
            params![instance_id, user_id],
        )
        .await?;
    if participant_count(db, instance_id).await? == 0 {
        end_instance_row(db, instance_id).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// End a game early. The launcher or a group admin may do it; ending revokes
/// every token and code so iframes go dark immediately.
pub async fn end_instance(
    db: &Db,
    instance_id: i64,
    user_id: i64,
) -> ActivityResult<()> {
    let instance = get_instance(db, instance_id)
        .await?
        .ok_or(ActivityError::NotFound("Game not found"))?;
    let admin = groups::get_group(db, instance.group_id, user_id)
        .await
        .map_err(|e| match e {
            groups::GroupError::Db(err) => ActivityError::Db(err),
            groups::GroupError::NotFound(m)
            | groups::GroupError::Forbidden(m)
            | groups::GroupError::Invalid(m) => ActivityError::Forbidden(m),
        })?
        .is_some_and(|g| g.my_role == "admin");
    if instance.created_by != user_id && !admin {
        return Err(ActivityError::Forbidden("Only the host can end the game"));
    }
    end_instance_row(db, instance_id).await
}

async fn end_instance_row(db: &Db, instance_id: i64) -> ActivityResult<()> {
    db.conn()
        .execute(
            "UPDATE activity_instances SET status = 'ended', ended_at = CURRENT_TIMESTAMP
             WHERE id = ?",
            params![instance_id],
        )
        .await?;
    db.conn()
        .execute(
            "DELETE FROM activity_tokens WHERE instance_id = ?",
            params![instance_id],
        )
        .await?;
    db.conn()
        .execute(
            "DELETE FROM activity_launch_codes WHERE instance_id = ?",
            params![instance_id],
        )
        .await?;
    Ok(())
}

async fn revoke_user_tokens(db: &Db, instance_id: i64, user_id: i64) -> ActivityResult<()> {
    db.conn()
        .execute(
            "DELETE FROM activity_tokens WHERE instance_id = ? AND user_id = ?",
            params![instance_id, user_id],
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::session::create_session;
    use libsql::params;

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

    async fn group_of(db: &Db) -> i64 {
        let (group, _) = groups::create_group(db, 1, "Team", &[2, 3])
            .await
            .unwrap();
        group.unwrap().id
    }

    async fn tictactoe(db: &Db) -> i64 {
        list_activities(db)
            .await
            .unwrap()
            .iter()
            .find(|a| a.slug == "tictactoe")
            .expect("seeded catalog")
            .id
    }

    #[tokio::test]
    async fn the_catalog_seeds_tictactoe() {
        let db = seeded_db().await;
        let game = tictactoe(&db).await;
        let entry = get_activity(&db, game).await.unwrap().expect("entry");
        assert_eq!(entry.max_players, 2);
        assert_eq!(entry.entry_url, "/activities/tictactoe");
    }

    #[tokio::test]
    async fn launch_requires_membership_and_an_enabled_activity() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;

        assert!(matches!(
            launch_instance(&db, game, gid, 4).await,
            Err(ActivityError::Forbidden(_))
        ));
        assert!(matches!(
            launch_instance(&db, 9999, gid, 1).await,
            Err(ActivityError::NotFound(_))
        ));
        let instance = launch_instance(&db, game, gid, 1).await.unwrap();
        assert_eq!(instance.status, ActivityStatus::Active);
        assert!(is_participant(&db, instance.id, 1).await.unwrap());
    }

    #[tokio::test]
    async fn join_honors_max_players() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        let instance = launch_instance(&db, game, gid, 1).await.unwrap();

        join_instance(&db, instance.id, 2).await.unwrap();
        assert!(matches!(
            join_instance(&db, instance.id, 3).await,
            Err(ActivityError::Invalid(_))
        ));
        assert!(!is_participant(&db, instance.id, 3).await.unwrap());
    }

    #[tokio::test]
    async fn codes_are_single_use_and_bound_to_their_instance() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        let a = launch_instance(&db, game, gid, 1).await.unwrap();
        let b = launch_instance(&db, game, gid, 1).await.unwrap();

        let code = join_instance(&db, a.id, 2).await.unwrap();
        assert!(matches!(
            exchange_code(&db, b.id, &code).await,
            Err(ActivityError::Invalid(_))
        ));
        let (token, user_id) = exchange_code(&db, a.id, &code).await.unwrap();
        assert_eq!(user_id, 2);
        assert!(matches!(
            exchange_code(&db, a.id, &code).await,
            Err(ActivityError::Invalid(_))
        ));
        let identity = instance_token_identity(&db, &token)
            .await
            .unwrap()
            .expect("token resolves");
        assert_eq!(identity.instance_id, a.id);
        assert_eq!(identity.user_id, 2);
    }

    #[tokio::test]
    async fn a_second_join_leaves_the_first_code_spendable() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        let instance = launch_instance(&db, game, gid, 1).await.unwrap();

        // The host re-joins on every `ready` (a retry looks exactly like a
        // reload), so each delivered code must survive later mints.
        let first = join_instance(&db, instance.id, 2).await.unwrap();
        let second = join_instance(&db, instance.id, 2).await.unwrap();
        assert_ne!(first, second);
        let (_, user_id) = exchange_code(&db, instance.id, &first).await.unwrap();
        assert_eq!(user_id, 2);
        let (_, user_id) = exchange_code(&db, instance.id, &second).await.unwrap();
        assert_eq!(user_id, 2);
    }

    #[tokio::test]
    async fn expired_codes_are_refused() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        let instance = launch_instance(&db, game, gid, 1).await.unwrap();
        let code = random_token();
        db.conn()
            .execute(
                "INSERT INTO activity_launch_codes (code_hash, instance_id, user_id, expires_at)
                 VALUES (?, ?, ?, ?)",
                params![hash_token(&code), instance.id, 2, "2000-01-01T00:00:00Z"],
            )
            .await
            .unwrap();
        assert!(matches!(
            exchange_code(&db, instance.id, &code).await,
            Err(ActivityError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn session_tokens_never_resolve_as_instance_tokens() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        let instance = launch_instance(&db, game, gid, 1).await.unwrap();
        let _ = join_instance(&db, instance.id, 2).await.unwrap();

        // A full-power legacy session token proves nothing to the game API:
        // the lookup is confined to the activity_tokens table.
        let session = create_session(&db, 2).await.unwrap();
        assert!(instance_token_identity(&db, &session).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn leaving_revokes_tokens_and_the_last_seat_ends_the_game() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        let instance = launch_instance(&db, game, gid, 1).await.unwrap();
        let code = join_instance(&db, instance.id, 2).await.unwrap();
        let (token, _) = exchange_code(&db, instance.id, &code).await.unwrap();

        assert!(!leave_instance(&db, instance.id, 2).await.unwrap());
        assert!(instance_token_identity(&db, &token).await.unwrap().is_none());
        assert!(leave_instance(&db, instance.id, 1).await.unwrap());
        let ended = get_instance(&db, instance.id).await.unwrap().unwrap();
        assert_eq!(ended.status, ActivityStatus::Ended);
        assert!(matches!(
            join_instance(&db, instance.id, 2).await,
            Err(ActivityError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn only_the_host_or_a_group_admin_ends_a_game() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        let instance = launch_instance(&db, game, gid, 2).await.unwrap();

        assert!(matches!(
            end_instance(&db, instance.id, 3).await,
            Err(ActivityError::Forbidden(_))
        ));
        end_instance(&db, instance.id, 1).await.unwrap();
        let ended = get_instance(&db, instance.id).await.unwrap().unwrap();
        assert_eq!(ended.status, ActivityStatus::Ended);
    }

    #[tokio::test]
    async fn non_members_see_no_instances() {
        let db = seeded_db().await;
        let gid = group_of(&db).await;
        let game = tictactoe(&db).await;
        launch_instance(&db, game, gid, 1).await.unwrap();

        assert_eq!(active_instances_for_group(&db, gid, 2).await.unwrap().len(), 1);
        assert!(matches!(
            active_instances_for_group(&db, gid, 4).await,
            Err(ActivityError::Forbidden(_))
        ));
    }
}

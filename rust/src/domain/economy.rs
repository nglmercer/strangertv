//! Points economy for authenticated users: ledger + cached balances.
//!
//! No real money moves here. Points reward participation and good behavior
//! (signup grant, ad claims, gifts) and are consumed by matchmaking; admins
//! adjust balances manually for rewards and penalties. Every mutation writes
//! one `point_ledger` row per affected user inside the same transaction as
//! the `users.points_balance` update, so the cache can never drift from the
//! audit trail. Guests never touch this module: the matchmaking gate rejects
//! them before any spend.

use libsql::{params, Connection};

use crate::constants::{
    ECONOMY_AD_COOLDOWN_SECS, ECONOMY_AD_DAILY_CAP, ECONOMY_AD_REWARD, ECONOMY_START_BALANCE,
};

pub const REASON_SIGNUP_GRANT: &str = "signup_grant";
pub const REASON_MATCH_SPEND: &str = "match_spend";
pub const REASON_AD_REWARD: &str = "ad_reward";
pub const REASON_GIFT_SEND: &str = "gift_send";
pub const REASON_GIFT_RECEIVE: &str = "gift_receive";
pub const REASON_ADMIN_ADJUST: &str = "admin_adjust";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpendOutcome {
    Paid { new_balance: i64 },
    Insufficient { current: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GiftOutcome {
    Sent { sender_balance: i64 },
    Insufficient { current: i64 },
    NoSuchUser,
    InvalidAmount,
    SelfGift,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdOutcome {
    Granted { new_balance: i64, next_claim_at: i64 },
    Cooldown { next_claim_at: i64 },
    Capped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeaderEntry {
    pub user_id: i64,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub balance: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerEntry {
    pub delta: i64,
    pub reason: String,
    pub ref_id: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
}

/// Cached balance, or 0 for an unknown user.
pub async fn balance(conn: &Connection, user_id: i64) -> anyhow::Result<i64> {
    let mut rows = conn
        .query(
            "SELECT points_balance FROM users WHERE id = ?",
            params![user_id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(0);
    };
    Ok(row.get::<i64>(0).unwrap_or(0))
}

/// Starting grant for a freshly created account.
pub async fn signup_grant(conn: &Connection, user_id: i64) -> anyhow::Result<i64> {
    let tx = conn.transaction().await?;
    tx.execute(
        "UPDATE users SET points_balance = points_balance + ? WHERE id = ?",
        params![ECONOMY_START_BALANCE, user_id],
    )
    .await?;
    tx.execute(
        "INSERT INTO point_ledger (user_id, delta, reason) VALUES (?, ?, ?)",
        params![user_id, ECONOMY_START_BALANCE, REASON_SIGNUP_GRANT],
    )
    .await?;
    let new_balance = read_balance_tx(&tx, user_id).await?;
    tx.commit().await?;
    Ok(new_balance)
}

/// Atomically deduct `amount` when the balance covers it. The conditional
/// `UPDATE` is the linearization point: concurrent spends cannot overdraw.
pub async fn spend(
    conn: &Connection,
    user_id: i64,
    amount: i64,
    reason: &str,
    ref_id: Option<&str>,
) -> anyhow::Result<SpendOutcome> {
    let tx = conn.transaction().await?;
    let changed = tx
        .execute(
            "UPDATE users SET points_balance = points_balance - ?
             WHERE id = ? AND points_balance >= ?",
            params![amount, user_id, amount],
        )
        .await?;
    if changed == 0 {
        tx.rollback().await?;
        return Ok(SpendOutcome::Insufficient {
            current: balance(conn, user_id).await?,
        });
    }
    tx.execute(
        "INSERT INTO point_ledger (user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?)",
        params![user_id, -amount, reason, ref_id],
    )
    .await?;
    let new_balance = read_balance_tx(&tx, user_id).await?;
    tx.commit().await?;
    Ok(SpendOutcome::Paid { new_balance })
}

/// Move points between two users. Both balance updates and both ledger rows
/// commit atomically; the debit is conditional so the sender cannot overdraw.
pub async fn gift(
    conn: &Connection,
    from_id: i64,
    to_id: i64,
    amount: i64,
) -> anyhow::Result<GiftOutcome> {
    if amount < 1 {
        return Ok(GiftOutcome::InvalidAmount);
    }
    if from_id == to_id {
        return Ok(GiftOutcome::SelfGift);
    }
    let mut rows = conn
        .query("SELECT id FROM users WHERE id = ?", params![to_id])
        .await?;
    if rows.next().await?.is_none() {
        return Ok(GiftOutcome::NoSuchUser);
    }
    drop(rows);

    let tx = conn.transaction().await?;
    let changed = tx
        .execute(
            "UPDATE users SET points_balance = points_balance - ?
             WHERE id = ? AND points_balance >= ?",
            params![amount, from_id, amount],
        )
        .await?;
    if changed == 0 {
        tx.rollback().await?;
        return Ok(GiftOutcome::Insufficient {
            current: balance(conn, from_id).await?,
        });
    }
    tx.execute(
        "UPDATE users SET points_balance = points_balance + ? WHERE id = ?",
        params![amount, to_id],
    )
    .await?;
    let from_ref = from_id.to_string();
    let to_ref = to_id.to_string();
    tx.execute(
        "INSERT INTO point_ledger (user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?)",
        params![from_id, -amount, REASON_GIFT_SEND, to_ref],
    )
    .await?;
    tx.execute(
        "INSERT INTO point_ledger (user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?)",
        params![to_id, amount, REASON_GIFT_RECEIVE, from_ref],
    )
    .await?;
    let sender_balance = read_balance_tx(&tx, from_id).await?;
    tx.commit().await?;
    Ok(GiftOutcome::Sent { sender_balance })
}

/// Ad-reward claim with a per-user cooldown and a UTC-day cap. Clocks come
/// from SQLite (`strftime`), so callers pass no time and tests backdate rows.
pub async fn claim_ad(conn: &Connection, user_id: i64) -> anyhow::Result<AdOutcome> {
    let now = unix_now(conn).await?;
    let mut rows = conn
        .query(
            "SELECT MAX(strftime('%s', created_at)) FROM point_ledger
             WHERE user_id = ? AND reason = ?",
            params![user_id, REASON_AD_REWARD],
        )
        .await?;
    let last: Option<i64> = match rows.next().await? {
        Some(row) => row.get::<String>(0).ok().and_then(|s| s.parse().ok()),
        None => None,
    };
    drop(rows);
    if let Some(last) = last {
        if now - last < ECONOMY_AD_COOLDOWN_SECS {
            return Ok(AdOutcome::Cooldown {
                next_claim_at: last + ECONOMY_AD_COOLDOWN_SECS,
            });
        }
    }
    let mut rows = conn
        .query(
            "SELECT COUNT(*) FROM point_ledger
             WHERE user_id = ? AND reason = ? AND date(created_at) = date('now')",
            params![user_id, REASON_AD_REWARD],
        )
        .await?;
    let today: i64 = match rows.next().await? {
        Some(row) => row.get(0).unwrap_or(0),
        None => 0,
    };
    drop(rows);
    if today >= ECONOMY_AD_DAILY_CAP {
        return Ok(AdOutcome::Capped);
    }

    let tx = conn.transaction().await?;
    tx.execute(
        "UPDATE users SET points_balance = points_balance + ? WHERE id = ?",
        params![ECONOMY_AD_REWARD, user_id],
    )
    .await?;
    tx.execute(
        "INSERT INTO point_ledger (user_id, delta, reason) VALUES (?, ?, ?)",
        params![user_id, ECONOMY_AD_REWARD, REASON_AD_REWARD],
    )
    .await?;
    let new_balance = read_balance_tx(&tx, user_id).await?;
    tx.commit().await?;
    Ok(AdOutcome::Granted {
        new_balance,
        next_claim_at: now + ECONOMY_AD_COOLDOWN_SECS,
    })
}

/// Manual admin adjustment, positive or negative. Penalties intentionally
/// have no floor: they bite even at a zero balance.
pub async fn adjust(
    conn: &Connection,
    user_id: i64,
    delta: i64,
    note: &str,
) -> anyhow::Result<i64> {
    let tx = conn.transaction().await?;
    tx.execute(
        "UPDATE users SET points_balance = points_balance + ? WHERE id = ?",
        params![delta, user_id],
    )
    .await?;
    tx.execute(
        "INSERT INTO point_ledger (user_id, delta, reason, note) VALUES (?, ?, ?, ?)",
        params![user_id, delta, REASON_ADMIN_ADJUST, note],
    )
    .await?;
    let new_balance = read_balance_tx(&tx, user_id).await?;
    tx.commit().await?;
    Ok(new_balance)
}

/// Top holders, usernames only — never emails.
pub async fn leaderboard(conn: &Connection, limit: i64) -> anyhow::Result<Vec<LeaderEntry>> {
    let mut rows = conn
        .query(
            "SELECT id, username, display_name, points_balance FROM users
             ORDER BY points_balance DESC, id ASC LIMIT ?",
            params![limit.max(1)],
        )
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(LeaderEntry {
            user_id: row.get(0)?,
            username: row.get::<String>(1).ok(),
            display_name: row.get::<String>(2).ok().filter(|s| !s.is_empty()),
            balance: row.get(3).unwrap_or(0),
        });
    }
    Ok(out)
}

/// Most recent ledger rows for one user, newest first.
pub async fn recent(
    conn: &Connection,
    user_id: i64,
    limit: i64,
) -> anyhow::Result<Vec<LedgerEntry>> {
    let mut rows = conn
        .query(
            "SELECT delta, reason, ref_id, note, created_at FROM point_ledger
             WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            params![user_id, limit.max(1)],
        )
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(LedgerEntry {
            delta: row.get(0)?,
            reason: row.get(1)?,
            ref_id: row.get::<String>(2).ok(),
            note: row.get::<String>(3).ok(),
            created_at: row.get(4)?,
        });
    }
    Ok(out)
}

/// One-time grant for accounts created before the economy existed. Only
/// users without a `signup_grant` row are touched, so re-running is safe.
pub async fn backfill_balances(conn: &Connection) -> anyhow::Result<u64> {
    let mut rows = conn
        .query(
            "SELECT id FROM users WHERE id NOT IN (
               SELECT user_id FROM point_ledger WHERE reason = ?
             )",
            params![REASON_SIGNUP_GRANT],
        )
        .await?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next().await? {
        ids.push(row.get::<i64>(0)?);
    }
    drop(rows);
    for id in &ids {
        signup_grant(conn, *id).await?;
    }
    Ok(ids.len() as u64)
}

async fn read_balance_tx(tx: &libsql::Transaction, user_id: i64) -> anyhow::Result<i64> {
    let mut rows = tx
        .query(
            "SELECT points_balance FROM users WHERE id = ?",
            params![user_id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(0);
    };
    Ok(row.get::<i64>(0).unwrap_or(0))
}

async fn unix_now(conn: &Connection) -> anyhow::Result<i64> {
    let mut rows = conn.query("SELECT strftime('%s', 'now')", ()).await?;
    let Some(row) = rows.next().await? else {
        anyhow::bail!("clock unavailable");
    };
    Ok(row
        .get::<String>(0)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use std::time::{SystemTime, UNIX_EPOCH};

    async fn test_db() -> (Db, std::path::PathBuf) {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        // Thread id keeps parallel tests from sharing a file when the clock
        // repeats a nanos value.
        let path = std::env::temp_dir().join(format!(
            "stranger-economy-{:?}-{suffix}.db",
            std::thread::current().id()
        ));
        let url = format!("file:{}", path.display());
        let db = Db::open(&url).await.expect("database");
        db.migrate().await.expect("schema");
        (db, path)
    }

    async fn add_user(conn: &Connection, email: &str) -> i64 {
        conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, 'x')",
            params![email],
        )
        .await
        .expect("user insert");
        let mut rows = conn
            .query("SELECT id FROM users WHERE email = ?", params![email])
            .await
            .expect("user lookup");
        let id = rows
            .next()
            .await
            .expect("row")
            .expect("user")
            .get(0)
            .expect("id");
        id
    }

    #[tokio::test]
    async fn backfill_grants_each_pre_economy_user_exactly_once() {
        let (db, path) = test_db().await;
        let a = add_user(db.conn(), "a@example.com").await;
        let b = add_user(db.conn(), "b@example.com").await;

        assert_eq!(backfill_balances(db.conn()).await.expect("backfill"), 2);
        assert_eq!(
            balance(db.conn(), a).await.expect("balance"),
            ECONOMY_START_BALANCE
        );
        // Second run is a no-op: no double grant.
        assert_eq!(backfill_balances(db.conn()).await.expect("backfill"), 0);
        assert_eq!(
            balance(db.conn(), b).await.expect("balance"),
            ECONOMY_START_BALANCE
        );

        drop(db);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn spend_deducts_but_insufficient_leaves_everything_untouched() {
        let (db, path) = test_db().await;
        let user = add_user(db.conn(), "spender@example.com").await;
        signup_grant(db.conn(), user).await.expect("grant");

        let paid = spend(db.conn(), user, 30, REASON_MATCH_SPEND, None)
            .await
            .expect("spend");
        assert_eq!(
            paid,
            SpendOutcome::Paid {
                new_balance: ECONOMY_START_BALANCE - 30
            }
        );

        let broke = spend(db.conn(), user, 10_000, REASON_MATCH_SPEND, None)
            .await
            .expect("spend");
        assert_eq!(
            broke,
            SpendOutcome::Insufficient {
                current: ECONOMY_START_BALANCE - 30
            }
        );
        // No ledger row for the failed spend.
        let entries = recent(db.conn(), user, 10).await.expect("recent");
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|e| e.reason != "failed"));

        drop(db);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn gift_moves_funds_and_rejects_bad_transfers() {
        let (db, path) = test_db().await;
        let from = add_user(db.conn(), "from@example.com").await;
        let to = add_user(db.conn(), "to@example.com").await;
        signup_grant(db.conn(), from).await.expect("grant");
        signup_grant(db.conn(), to).await.expect("grant");

        let sent = gift(db.conn(), from, to, 25).await.expect("gift");
        assert_eq!(
            sent,
            GiftOutcome::Sent {
                sender_balance: ECONOMY_START_BALANCE - 25
            }
        );
        assert_eq!(
            balance(db.conn(), to).await.expect("balance"),
            ECONOMY_START_BALANCE + 25
        );

        assert_eq!(
            gift(db.conn(), from, to, 0).await.expect("zero"),
            GiftOutcome::InvalidAmount
        );
        assert_eq!(
            gift(db.conn(), from, from, 1).await.expect("self"),
            GiftOutcome::SelfGift
        );
        assert_eq!(
            gift(db.conn(), from, 999_999, 1).await.expect("ghost"),
            GiftOutcome::NoSuchUser
        );
        assert!(matches!(
            gift(db.conn(), from, to, 10_000).await.expect("broke"),
            GiftOutcome::Insufficient { .. }
        ));
        // Failed transfers leave both sides untouched.
        assert_eq!(
            balance(db.conn(), from).await.expect("balance"),
            ECONOMY_START_BALANCE - 25
        );

        drop(db);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn ad_claims_are_cooldown_and_capped() {
        let (db, path) = test_db().await;
        let user = add_user(db.conn(), "ads@example.com").await;
        signup_grant(db.conn(), user).await.expect("grant");

        let first = claim_ad(db.conn(), user).await.expect("claim");
        let granted = match first {
            AdOutcome::Granted {
                new_balance,
                next_claim_at,
            } => {
                assert_eq!(new_balance, ECONOMY_START_BALANCE + ECONOMY_AD_REWARD);
                next_claim_at
            }
            other => panic!("first claim must grant, got {other:?}"),
        };
        // Immediate reclaim hits the cooldown with the same horizon.
        assert_eq!(
            claim_ad(db.conn(), user).await.expect("claim"),
            AdOutcome::Cooldown {
                next_claim_at: granted
            }
        );

        // Age the claim past the cooldown: the next claim grants again.
        db.conn()
            .execute(
                "UPDATE point_ledger SET created_at = datetime('now', '-1 hour')
                 WHERE user_id = ? AND reason = ?",
                params![user, REASON_AD_REWARD],
            )
            .await
            .expect("backdate");
        assert!(matches!(
            claim_ad(db.conn(), user).await.expect("claim"),
            AdOutcome::Granted { .. }
        ));

        // Fill the UTC-day cap with backdated-today rows, then age the newest
        // past the cooldown so only the cap can reject.
        for _ in 0..(ECONOMY_AD_DAILY_CAP - 2) {
            db.conn()
                .execute(
                    "INSERT INTO point_ledger (user_id, delta, reason, created_at)
                     VALUES (?, ?, ?, datetime('now', '-2 hours'))",
                    params![user, ECONOMY_AD_REWARD, REASON_AD_REWARD],
                )
                .await
                .expect("cap row");
        }
        db.conn()
            .execute(
                "UPDATE point_ledger SET created_at = datetime('now', '-2 hours')
                 WHERE user_id = ? AND reason = ? AND date(created_at) = date('now')",
                params![user, REASON_AD_REWARD],
            )
            .await
            .expect("backdate");
        assert_eq!(
            claim_ad(db.conn(), user).await.expect("claim"),
            AdOutcome::Capped
        );

        drop(db);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn leaderboard_orders_by_balance_and_admin_adjust_has_no_floor() {
        let (db, path) = test_db().await;
        let low = add_user(db.conn(), "low@example.com").await;
        let high = add_user(db.conn(), "high@example.com").await;
        signup_grant(db.conn(), low).await.expect("grant");
        signup_grant(db.conn(), high).await.expect("grant");
        adjust(db.conn(), high, 50, "good citizen").await.expect("adjust");
        // A penalty bites through zero.
        let negative = adjust(db.conn(), low, -10_000, "validated abuse")
            .await
            .expect("adjust");
        assert!(negative < 0);

        let leaders = leaderboard(db.conn(), 10).await.expect("leaders");
        assert_eq!(leaders.len(), 2);
        assert_eq!(leaders[0].user_id, high);
        assert_eq!(leaders[1].user_id, low);
        let top_one = leaderboard(db.conn(), 1).await.expect("capped");
        assert_eq!(top_one.len(), 1);
        assert_eq!(top_one[0].user_id, high);

        drop(db);
        let _ = std::fs::remove_file(path);
    }
}

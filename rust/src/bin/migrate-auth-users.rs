//! Restartable import of StrangerTV users into Better Auth's user/account
//! tables. This command never mutates the plural legacy `users` table.

#![allow(dead_code)]

#[path = "../auth/password.rs"]
pub mod password;
mod auth {
    pub use crate::password;
}
#[path = "../auth/better_auth.rs"]
mod better_auth_state;
#[path = "../config.rs"]
mod config;

use better_auth::core::{DbAdapter, Query};
use better_auth::ImportCredential;
use better_auth_state::{open_legacy_database, BetterAuthState};
use config::Config;
use libsql::{params_from_iter, Value};
use serde_json::{Map, Value as JsonValue};

#[derive(Debug, Default)]
struct Options {
    dry_run: bool,
    limit: Option<u32>,
    user_id: Option<i64>,
    after_id: Option<i64>,
}

#[derive(Debug)]
struct LegacyUser {
    id: i64,
    email: String,
    password_hash: String,
    email_verified: bool,
}

#[derive(Debug)]
enum Preflight {
    New,
    AlreadyImported,
    Conflict,
    Failed,
}

#[derive(Debug, Default)]
struct Summary {
    scanned: u64,
    imported: u64,
    already_imported: u64,
    conflicts: u64,
    failed: u64,
    would_import: u64,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("migrate-auth-users failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> anyhow::Result<()> {
    let options = parse_options()?;
    let config = Config::from_env();
    let auth = BetterAuthState::connect_from_env(&config).await?;
    let legacy = open_legacy_database(&config).await?;
    let credential_service = &auth.credentials;
    let has_email_verified = has_column(&legacy.conn, "users", "email_verified").await?;
    let mut rows = source_rows(&legacy.conn, &options, has_email_verified).await?;
    // Drain and drop the source read cursor before writing through the second
    // libSQL connection. SQLite otherwise keeps a read transaction open and
    // the destination account transaction can report `database is locked`.
    let mut source_users = Vec::new();
    while let Some(row) = rows.next().await? {
        source_users.push(read_legacy_user(&row, has_email_verified));
    }
    drop(rows);
    let mut summary = Summary::default();

    for source_user in source_users {
        summary.scanned += 1;
        let user = match source_user {
            Ok(user) => user,
            Err(error) => {
                summary.failed += 1;
                eprintln!("user import failed while reading source row: {error}");
                continue;
            }
        };

        match preflight(auth.adapter.as_ref(), &user).await {
            Ok(Preflight::AlreadyImported) => {
                summary.already_imported += 1;
            }
            Ok(Preflight::Conflict) => {
                summary.conflicts += 1;
                eprintln!("user {} has a Better Auth identity conflict", user.id);
            }
            Ok(Preflight::Failed) => {
                summary.failed += 1;
                eprintln!("user {} has an incomplete Better Auth import", user.id);
            }
            Ok(Preflight::New) => {
                if !password::is_legacy_hash_format(&user.password_hash) {
                    summary.failed += 1;
                    eprintln!("user {} has an unsupported legacy password format", user.id);
                    continue;
                }
                if options.dry_run {
                    summary.would_import += 1;
                    continue;
                }
                let credential = ImportCredential {
                    id: Some(user.id.to_string()),
                    email: user.email.trim().to_ascii_lowercase(),
                    name: display_name(&user.email),
                    email_verified: user.email_verified,
                    password_hash: user.password_hash,
                    additional_fields: Map::new(),
                };
                match credential_service.import(credential).await {
                    Ok(_) => summary.imported += 1,
                    Err(error) => {
                        summary.failed += 1;
                        eprintln!("user {} import failed: {error}", user.id);
                    }
                }
            }
            Err(error) => {
                summary.failed += 1;
                eprintln!("user {} preflight failed: {error}", user.id);
            }
        }
    }

    println!(
        "auth user import scanned={} auth_import_imported={} auth_import_already_imported={} auth_import_conflict={} auth_import_failed={}{}",
        summary.scanned,
        summary.imported,
        summary.already_imported,
        summary.conflicts,
        summary.failed,
        if options.dry_run {
            format!(" would_import={}", summary.would_import)
        } else {
            String::new()
        }
    );

    if summary.conflicts > 0 || summary.failed > 0 {
        anyhow::bail!("user import completed with conflicts or failures");
    }
    Ok(())
}

fn parse_options() -> anyhow::Result<Options> {
    let mut options = Options::default();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--dry-run" => options.dry_run = true,
            "--limit" => options.limit = Some(parse_positive(&arg, &mut args)?),
            "--user-id" => options.user_id = Some(parse_integer(&arg, &mut args)?),
            "--after-id" => options.after_id = Some(parse_integer(&arg, &mut args)?),
            "--help" | "-h" => {
                println!(
                    "Usage: migrate-auth-users [--dry-run] [--limit N] [--user-id ID] [--after-id ID]"
                );
                std::process::exit(0);
            }
            unknown => anyhow::bail!("unknown option: {unknown}"),
        }
    }
    if options.user_id.is_some() && options.after_id.is_some() {
        anyhow::bail!("--user-id and --after-id cannot be combined");
    }
    Ok(options)
}

fn parse_positive(option: &str, args: &mut impl Iterator<Item = String>) -> anyhow::Result<u32> {
    let value = args
        .next()
        .ok_or_else(|| anyhow::anyhow!("{option} requires a value"))?;
    let parsed = value
        .parse::<u32>()
        .map_err(|_| anyhow::anyhow!("{option} must be a positive integer"))?;
    if parsed == 0 {
        anyhow::bail!("{option} must be a positive integer");
    }
    Ok(parsed)
}

fn parse_integer(option: &str, args: &mut impl Iterator<Item = String>) -> anyhow::Result<i64> {
    let value = args
        .next()
        .ok_or_else(|| anyhow::anyhow!("{option} requires a value"))?;
    value
        .parse::<i64>()
        .map_err(|_| anyhow::anyhow!("{option} must be an integer"))
}

async fn has_column(conn: &libsql::Connection, table: &str, wanted: &str) -> anyhow::Result<bool> {
    let mut rows = conn
        .query(&format!("PRAGMA table_info({table})"), ())
        .await?;
    while let Some(row) = rows.next().await? {
        let name: String = row.get(1)?;
        if name == wanted {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn source_rows<'a>(
    conn: &'a libsql::Connection,
    options: &Options,
    has_email_verified: bool,
) -> anyhow::Result<libsql::Rows> {
    let mut sql = String::from("SELECT id, email, password_hash");
    if has_email_verified {
        sql.push_str(", email_verified");
    }
    sql.push_str(" FROM users");

    let mut values = Vec::new();
    if let Some(user_id) = options.user_id {
        sql.push_str(" WHERE id = ?");
        values.push(Value::Integer(user_id));
    } else if let Some(after_id) = options.after_id {
        sql.push_str(" WHERE id > ?");
        values.push(Value::Integer(after_id));
    }
    sql.push_str(" ORDER BY id ASC");
    if let Some(limit) = options.limit {
        sql.push_str(" LIMIT ?");
        values.push(Value::Integer(i64::from(limit)));
    }
    Ok(conn.query(&sql, params_from_iter(values)).await?)
}

fn read_legacy_user(row: &libsql::Row, has_email_verified: bool) -> anyhow::Result<LegacyUser> {
    Ok(LegacyUser {
        id: row.get(0)?,
        email: row.get(1)?,
        password_hash: row.get(2)?,
        email_verified: has_email_verified && row.get(3).unwrap_or(0) != 0,
    })
}

async fn preflight(adapter: &dyn DbAdapter, user: &LegacyUser) -> anyhow::Result<Preflight> {
    let id = user.id.to_string();
    let email = user.email.trim().to_ascii_lowercase();
    let by_id = find_user_by(adapter, Query::new().eq("id", id.clone())).await?;
    let by_email = find_user_by(adapter, Query::new().eq("email", email.clone())).await?;

    if by_id.is_none() && by_email.is_none() {
        return Ok(Preflight::New);
    }

    let id_matches = by_id
        .as_ref()
        .is_some_and(|record| same_identity(record, &id, &email));
    let email_matches = by_email
        .as_ref()
        .is_some_and(|record| same_identity(record, &id, &email));
    if !id_matches || !email_matches {
        return Ok(Preflight::Conflict);
    }

    let account_id = format!("{id}:credential");
    let account = adapter
        .find_one("account", Query::new().eq("id", account_id))
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let Some(account) = account else {
        return Ok(Preflight::Failed);
    };
    match account.get("password_hash").and_then(JsonValue::as_str) {
        // A successful Better Auth login may already have replaced the
        // imported legacy hash with a PHC hash. Matching identity is enough
        // to classify this row as imported; never overwrite that newer hash.
        Some(existing) if !existing.is_empty() => Ok(Preflight::AlreadyImported),
        None => Ok(Preflight::Failed),
        Some(_) => Ok(Preflight::Failed),
    }
}

async fn find_user_by(adapter: &dyn DbAdapter, query: Query) -> anyhow::Result<Option<JsonValue>> {
    adapter
        .find_one("user", query)
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))
}

fn same_identity(record: &JsonValue, id: &str, email: &str) -> bool {
    record.get("id").and_then(JsonValue::as_str) == Some(id)
        && record
            .get("email")
            .and_then(JsonValue::as_str)
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref()
            == Some(email)
}

fn display_name(email: &str) -> String {
    let local = email.split('@').next().unwrap_or(email).trim();
    let name: String = local.chars().take(200).collect();
    if name.is_empty() {
        "StrangerTV user".into()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use better_auth::core::{adapter::memory::MemoryDb, DbAdapter};

    #[tokio::test]
    async fn rehashed_matching_identity_is_already_imported() {
        let adapter = MemoryDb::default();
        adapter
            .insert_record(
                "user",
                serde_json::json!({
                    "id": "42",
                    "email": "user@example.com"
                }),
            )
            .await
            .expect("user record");
        adapter
            .insert_record(
                "account",
                serde_json::json!({
                    "id": "42:credential",
                    "user_id": "42",
                    "password_hash": "$scrypt$ln=14,r=8,p=1$already-rehashed"
                }),
            )
            .await
            .expect("account record");

        let result = preflight(
            &adapter,
            &LegacyUser {
                id: 42,
                email: "USER@example.com".into(),
                password_hash: "legacy-hash-no-longer-stored".into(),
                email_verified: false,
            },
        )
        .await
        .expect("preflight");
        assert!(matches!(result, Preflight::AlreadyImported));
    }

    #[tokio::test]
    async fn conflicting_email_or_id_is_rejected() {
        let by_email = MemoryDb::default();
        by_email
            .insert_record(
                "user",
                serde_json::json!({
                    "id": "99",
                    "email": "user@example.com"
                }),
            )
            .await
            .expect("email conflict record");
        let email_conflict = preflight(
            &by_email,
            &LegacyUser {
                id: 42,
                email: "user@example.com".into(),
                password_hash: "legacy".into(),
                email_verified: false,
            },
        )
        .await
        .expect("email conflict preflight");
        assert!(matches!(email_conflict, Preflight::Conflict));

        let by_id = MemoryDb::default();
        by_id
            .insert_record(
                "user",
                serde_json::json!({
                    "id": "42",
                    "email": "other@example.com"
                }),
            )
            .await
            .expect("id conflict record");
        let id_conflict = preflight(
            &by_id,
            &LegacyUser {
                id: 42,
                email: "user@example.com".into(),
                password_hash: "legacy".into(),
                email_verified: false,
            },
        )
        .await
        .expect("id conflict preflight");
        assert!(matches!(id_conflict, Preflight::Conflict));
    }
}

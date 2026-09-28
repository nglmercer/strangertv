//! Values shared with `shared/constants.ts`.
//!
//! Careful: the TypeScript has TWO default sets and they are not the same.
//! `DEFAULT_GENDER`/`DEFAULT_COUNTRY`/`DEFAULT_LANGUAGE` below are the
//! application defaults used when a request omits a profile field and when
//! `publicUser` fills a null column — all three are `"any"`. `DB_DEFAULT_*` in
//! `db.rs` are the SQL column defaults (`other`/`any`/`en`), which only ever
//! apply to rows inserted without those columns. Using one where the other
//! belongs changes what the API returns.

pub const DEFAULT_GENDER: &str = "any";
pub const DEFAULT_COUNTRY: &str = "any";
pub const DEFAULT_LANGUAGE: &str = "any";

pub const CONSENT_KIND_TERMS_AGE: &str = "terms_age";

// ---------------------------------------------------------------------------
// Points economy tuning (authenticated users only; no real money).
// Kept as constants for v1 — promote to env when ops needs runtime tuning.
// ---------------------------------------------------------------------------
/// Starting balance for new registrations and one-time backfill.
pub const ECONOMY_START_BALANCE: i64 = 100;
/// Cost of one solo queue join / room:next / group-match create.
pub const ECONOMY_MATCH_COST: i64 = 5;
/// Points per ad-reward claim.
pub const ECONOMY_AD_REWARD: i64 = 10;
/// Seconds between ad claims per user.
pub const ECONOMY_AD_COOLDOWN_SECS: i64 = 60;
/// Max ad claims per user per UTC day.
pub const ECONOMY_AD_DAILY_CAP: i64 = 5;
/// Max leaderboard rows served.
pub const ECONOMY_LEADERBOARD_MAX: i64 = 50;

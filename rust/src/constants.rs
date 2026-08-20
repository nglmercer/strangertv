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

//! Google sign-in on top of Better Auth's OAuth primitives.
//!
//! The crate ships a complete `OAuthService`, but its `find_or_create_user`
//! mints a UUID for new accounts. This deployment cannot use that: the
//! resolver maps a Better Auth session to the application identity by parsing
//! the Better Auth user id as the legacy `users.id` (see
//! `resolver::application_user_from_better_auth`), so an OAuth user with a
//! UUID id would hold a valid session that resolves to nobody. Only the state
//! manager and the HTTP provider are reused here; account creation goes
//! through the same legacy-row-first path as `routes::auth::register`.

use std::sync::Arc;
use std::time::Duration;

use better_auth::core::{DbAdapter, DbOperation, Query, SecondaryStorage};
use better_auth::{
    HttpOAuthProvider, OAuthProvider, OAuthProviderConfig, OAuthStateManager, OAuthStateStorage,
    OAuthUserProfile, SecretKeySet,
};
// `reqwest::Url` is the same `url` crate the OAuth types use; depending on
// it through reqwest avoids a second direct dependency on it.
use reqwest::Url;
use serde_json::json;

use crate::auth::better_auth::BetterAuthState;
use crate::config::Config;

/// Google's authorization endpoint is fixed; `HttpOAuthProvider::config()`
/// already knows it for the `google` provider id.
const PROVIDER_ID: &str = "google";

/// The OAuth state (PKCE verifier + nonce) lives this long. Google's consent
/// screen can legitimately take a while, so this is generous but bounded.
const STATE_TTL: Duration = Duration::from_secs(10 * 60);

/// Everything needed to run the Google authorization-code flow.
pub struct GoogleOAuth {
    provider: HttpOAuthProvider,
    config: OAuthProviderConfig,
    state: OAuthStateManager,
    redirect_uri: String,
}

impl GoogleOAuth {
    /// `None` when the deployment has not configured Google sign-in. The
    /// feature is optional: every other auth path keeps working without it.
    pub fn from_env(
        config: &Config,
        better_auth: &BetterAuthState,
    ) -> anyhow::Result<Option<Self>> {
        let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
        let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default();
        if client_id.trim().is_empty() || client_secret.trim().is_empty() {
            return Ok(None);
        }

        // The redirect target is this API, which is normally the same origin
        // as the SPA. Split dev deployments (Vite on 5173, API on 8787) set
        // OAUTH_REDIRECT_BASE_URL to the API origin.
        let base = std::env::var("OAUTH_REDIRECT_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| config.app_url.clone());
        let redirect_uri = format!("{}{}", base.trim_end_matches('/'), CALLBACK_PATH);
        // Fail loudly at startup instead of at the first sign-in attempt.
        Url::parse(&redirect_uri).map_err(|error| {
            anyhow::anyhow!("invalid OAuth redirect URI {redirect_uri}: {error}")
        })?;

        let provider = HttpOAuthProvider::google(client_id, client_secret)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let mut provider_config = provider.config();
        provider_config.state_ttl = STATE_TTL;

        // Verification-mode state keeps the PKCE verifier in Better Auth's
        // secondary storage rather than a cookie, so the callback works even
        // when the provider redirect drops SameSite=Lax cookies.
        let keys = SecretKeySet::from_options(&better_auth.context.options)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let state = OAuthStateManager::new_with_cookie_options(
            Some(Arc::clone(&better_auth.secondary_storage) as Arc<dyn SecondaryStorage>),
            keys,
            OAuthStateStorage::Verification,
            better_auth.context.options.base_path.clone(),
            better_auth.context.options.cookie.clone(),
        )
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

        Ok(Some(Self {
            provider,
            config: provider_config,
            state,
            redirect_uri,
        }))
    }

    /// Start the flow: returns the Google URL the browser must be sent to.
    pub async fn authorization_url(&self, secure_cookie: bool) -> anyhow::Result<String> {
        let authorization = self
            .state
            .begin(&self.config, &self.redirect_uri, secure_cookie)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        Ok(authorization.authorization_url.to_string())
    }

    /// Finish the flow: validate the state, exchange the code, and return the
    /// verified Google profile. No account is touched here.
    ///
    /// The `id_token` is not trusted and therefore not validated: the profile
    /// comes from Google's userinfo endpoint, reached server-side with an
    /// access token this server obtained itself using the PKCE verifier and
    /// the client secret. Nothing downstream reads a client-supplied token.
    pub async fn verified_profile(
        &self,
        code: &str,
        state: &str,
    ) -> anyhow::Result<OAuthUserProfile> {
        let (_redirect_uri, verifier, nonce) =
            self.state
                .consume(PROVIDER_ID, state, None)
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let tokens = self
            .provider
            .exchange_code(code, &self.redirect_uri, &verifier)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        self.provider
            .validate_tokens(&tokens, &nonce)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        self.provider
            .profile(&tokens)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))
    }
}

/// Where Google sends the browser back. Shared with `routes::auth` so the
/// registered redirect URI and the mounted route cannot drift apart.
pub const CALLBACK_PATH: &str = "/api/v1/auth/oauth/google/callback";

/// Stable `account.id` for a provider identity, matching the crate's own
/// convention in `OAuthService::find_or_create_user`.
pub fn account_row_id(provider_account_id: &str) -> String {
    format!("oauth:{PROVIDER_ID}:{provider_account_id}")
}

/// Look up the application user id previously linked to this Google account.
pub async fn linked_user_id(
    better_auth: &BetterAuthState,
    provider_account_id: &str,
) -> anyhow::Result<Option<i64>> {
    let account = better_auth
        .adapter
        .find_one(
            "account",
            Query::new().eq("id", account_row_id(provider_account_id)),
        )
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(account
        .and_then(|row| {
            row.get("user_id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .and_then(|id| id.parse::<i64>().ok()))
}

/// Link a Google identity to an existing application user.
///
/// Only `id`, `user_id`, `provider_id` and `account_id` are written: the
/// crate's own OAuth path also stores a sealed `token_envelope`, but that
/// column is not part of the migrated `account` schema and the provider
/// access token is not needed here — no Google API is called after sign-in.
pub async fn link_account(
    better_auth: &BetterAuthState,
    user_id: i64,
    provider_account_id: &str,
) -> anyhow::Result<()> {
    better_auth
        .adapter
        .transaction(vec![DbOperation::InsertRecord {
            table: "account".into(),
            record: json!({
                "id": account_row_id(provider_account_id),
                "user_id": user_id.to_string(),
                "provider_id": PROVIDER_ID,
                "account_id": provider_account_id,
            }),
        }])
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(())
}

/// Create the Better Auth `user` row for a Google identity.
///
/// The id is the legacy `users.id` as a string, which is what the resolver
/// expects. There is deliberately no credential account: password sign-in for
/// this address must fail until the user sets a password through the reset
/// flow.
pub async fn create_better_auth_user(
    better_auth: &BetterAuthState,
    user_id: i64,
    profile: &OAuthUserProfile,
    email: &str,
) -> anyhow::Result<()> {
    let name = profile
        .name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| display_name_from_email(email));
    better_auth
        .adapter
        .transaction(vec![DbOperation::InsertRecord {
            table: "user".into(),
            record: json!({
                "id": user_id.to_string(),
                "email": email,
                "name": name.chars().take(200).collect::<String>(),
                "email_verified": profile.email_verified,
                "image": profile.image,
            }),
        }])
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Pending signups
// ---------------------------------------------------------------------------

/// A Google profile that has been verified but cannot become an account yet.
///
/// Google does not return a birth date, and this service is 18+: `login`
/// refuses any account without a valid adult birthday, and nothing else in
/// the request path re-checks it. Creating the user straight from the
/// callback would therefore either mint an under-age-capable account or an
/// account that can never sign in again. Instead the verified profile is
/// parked here until the browser posts a birth date back.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct PendingSignup {
    pub email: String,
    pub provider_account_id: String,
    pub name: Option<String>,
    pub image: Option<String>,
    pub email_verified: bool,
}

/// Pending signups expire quickly: the browser is redirected straight into
/// the form that consumes them.
const PENDING_TTL: Duration = Duration::from_secs(15 * 60);

fn pending_key(token_hash: &str) -> String {
    format!("stranger:oauth:pending:{token_hash}")
}

/// Park a verified profile and return the single-use claim token. Only the
/// token's hash is stored, so a storage read cannot be replayed as a signup.
pub async fn store_pending_signup(
    better_auth: &BetterAuthState,
    pending: &PendingSignup,
) -> anyhow::Result<String> {
    let token = crate::auth::password::random_token();
    let value = serde_json::to_value(pending)?;
    better_auth
        .secondary_storage
        .set(
            &pending_key(&crate::auth::password::hash_token(&token)),
            better_auth::core::StorageValue::with_ttl(value, PENDING_TTL),
        )
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(token)
}

/// Claim a pending signup. The record is deleted whether or not the caller
/// goes on to succeed, so a token cannot be replayed.
pub async fn take_pending_signup(
    better_auth: &BetterAuthState,
    token: &str,
) -> anyhow::Result<Option<PendingSignup>> {
    let stored = better_auth
        .secondary_storage
        .get_and_delete(&pending_key(&crate::auth::password::hash_token(token)))
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let Some(stored) = stored else {
        return Ok(None);
    };
    Ok(serde_json::from_value(stored.value).ok())
}

/// `user@example.com` -> `user`, mirroring the register handler.
pub fn display_name_from_email(email: &str) -> String {
    email
        .split('@')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("user")
        .chars()
        .take(200)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn account_ids_match_the_crate_convention() {
        assert_eq!(account_row_id("12345"), "oauth:google:12345");
    }

    #[test]
    fn display_names_fall_back_when_the_local_part_is_empty() {
        assert_eq!(display_name_from_email("ada@example.com"), "ada");
        assert_eq!(display_name_from_email("@example.com"), "user");
    }

    /// A migrated Better Auth state on a throwaway database file.
    async fn migrated_state(label: &str) -> (BetterAuthState, std::path::PathBuf) {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("stranger-oauth-{label}-{suffix}.db"));
        let url = format!("file:{}", path.display());
        let mut config = Config::from_env();
        config.better_auth_secret = "test-secret-that-is-at-least-32-bytes-long".into();
        let state = BetterAuthState::connect_with(&config, &url, "")
            .await
            .expect("Better Auth connects");
        state.apply_migrations().await.expect("schema applies");
        (state, path)
    }

    fn profile(sub: &str, email: &str) -> OAuthUserProfile {
        OAuthUserProfile {
            provider_account_id: sub.into(),
            email: Some(email.into()),
            name: Some("Ada Lovelace".into()),
            image: None,
            email_verified: true,
        }
    }

    #[tokio::test]
    async fn a_linked_account_resolves_back_to_the_numeric_application_id() {
        let (state, path) = migrated_state("link").await;

        assert_eq!(
            linked_user_id(&state, "sub-1").await.expect("lookup"),
            None,
            "an unlinked provider account belongs to nobody"
        );

        create_better_auth_user(
            &state,
            42,
            &profile("sub-1", "ada@example.com"),
            "ada@example.com",
        )
        .await
        .expect("user row");
        link_account(&state, 42, "sub-1").await.expect("link");

        // The resolver parses the Better Auth id as the legacy users.id, so
        // the round trip has to come back as the same integer.
        assert_eq!(
            linked_user_id(&state, "sub-1").await.expect("lookup"),
            Some(42)
        );
        let user = state
            .adapter
            .find_one("user", Query::new().eq("id", "42"))
            .await
            .expect("user lookup")
            .expect("user exists");
        assert_eq!(user["email"], "ada@example.com");
        assert_eq!(user["id"], "42");

        drop(state);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn a_google_signup_creates_no_credential_account() {
        let (state, path) = migrated_state("nocred").await;
        create_better_auth_user(
            &state,
            7,
            &profile("sub-7", "grace@example.com"),
            "grace@example.com",
        )
        .await
        .expect("user row");
        link_account(&state, 7, "sub-7").await.expect("link");

        // Password sign-in must stay impossible until the user sets one: the
        // credential account is what `login` looks for.
        assert!(
            !state
                .credential_account_exists(7)
                .await
                .expect("account lookup"),
            "Google users must not get a credential account"
        );

        drop(state);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn a_pending_signup_can_be_claimed_exactly_once() {
        let (state, path) = migrated_state("pending").await;
        let pending = PendingSignup {
            email: "ada@example.com".into(),
            provider_account_id: "sub-1".into(),
            name: Some("Ada".into()),
            image: None,
            email_verified: true,
        };

        let token = store_pending_signup(&state, &pending)
            .await
            .expect("stored");
        assert_eq!(
            take_pending_signup(&state, &token).await.expect("claim"),
            Some(pending)
        );
        assert_eq!(
            take_pending_signup(&state, &token).await.expect("replay"),
            None,
            "claiming twice would let one Google callback create two accounts"
        );
        assert_eq!(
            take_pending_signup(&state, "not-a-token")
                .await
                .expect("unknown"),
            None
        );

        drop(state);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn google_is_off_until_both_client_credentials_are_present() {
        let (state, path) = migrated_state("config").await;
        let config = Config::from_env();

        // The test process shares its environment, so assert on the absent
        // case only; a populated one is covered by the redirect-URI check.
        std::env::remove_var("GOOGLE_CLIENT_ID");
        std::env::remove_var("GOOGLE_CLIENT_SECRET");
        assert!(GoogleOAuth::from_env(&config, &state)
            .expect("no error")
            .is_none());

        drop(state);
        let _ = std::fs::remove_file(path);
    }
}

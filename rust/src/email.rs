//! Password-reset / verification mailer. Port of `server/email.ts`.
//!
//! Same three modes and the same precedence: webhook if `EMAIL_WEBHOOK_URL` is
//! set, otherwise a warning if `SMTP_URL` is set (the Node version never grew a
//! real SMTP client), otherwise log-only. Delivery is best-effort and never
//! fails the request that triggered it.

pub const SUBJECT_VERIFY: &str = "Verify your stranger email";
pub const SUBJECT_RESET: &str = "Reset your stranger password";

pub struct Mail {
    pub to: String,
    pub subject: String,
    pub text: String,
    pub html: String,
}

pub struct MailBody {
    pub text: String,
    pub html: String,
    pub link: String,
}

pub async fn send_email(mail: &Mail) -> (bool, &'static str) {
    let from = std::env::var("MAIL_FROM").unwrap_or_else(|_| "noreply@stranger.local".into());

    if let Ok(webhook) = std::env::var("EMAIL_WEBHOOK_URL") {
        if !webhook.is_empty() {
            let payload = serde_json::json!({
                "from": from,
                "to": mail.to,
                "subject": mail.subject,
                "text": mail.text,
                "html": mail.html,
            });
            return match post_json(&webhook, &payload).await {
                Ok(()) => {
                    crate::log_info!("email.sent", { "mode": "webhook", "to": mail.to });
                    (true, "webhook")
                }
                Err(err) => {
                    crate::log_error!("email.webhook_failed", { "err": err });
                    (false, "webhook")
                }
            };
        }
    }

    if std::env::var("SMTP_URL").is_ok_and(|v| !v.is_empty()) {
        crate::log_warn!("email.smtp_configured_but_use_webhook", {
            "hint": "Set EMAIL_WEBHOOK_URL for delivery without extra deps, or install a mailer.",
            "to": mail.to
        });
    }

    crate::log_info!("email.dev_log", {
        "mode": "log",
        "from": from,
        "to": mail.to,
        "subject": mail.subject,
        "text": mail.text
    });
    (true, "log")
}

async fn post_json(url: &str, payload: &serde_json::Value) -> Result<(), String> {
    let res = reqwest::Client::new()
        .post(url)
        .header("content-type", "application/json")
        .json(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("webhook {}", res.status().as_u16()));
    }
    Ok(())
}

/// Deep link into the SPA for the given URL param (trailing slash safe).
fn build_link(app_url: &str, param: &str, token: &str) -> String {
    format!(
        "{}/?{param}={}",
        app_url.trim_end_matches('/'),
        urlencode(token)
    )
}

/// `encodeURIComponent`. Tokens are base64url, so only rarely does anything
/// need escaping — but the reset flow breaks silently if it does and we don't.
fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*'
            | b'\'' | b'(' | b')' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn reset_email_body(token: &str, app_url: &str) -> MailBody {
    let link = build_link(app_url, "reset", token);
    MailBody {
        text: format!("{SUBJECT_RESET}\n\nToken: {token}\nOr open: {link}\n\nThis link expires in 1 hour."),
        html: format!(
            "<p>{SUBJECT_RESET}</p><p><a href=\"{link}\">Reset password</a></p><p>Or use token: <code>{token}</code></p><p>Expires in 1 hour.</p>"
        ),
        link,
    }
}

pub fn verify_email_body(token: &str, app_url: &str) -> MailBody {
    let link = build_link(app_url, "verify", token);
    MailBody {
        text: format!("{SUBJECT_VERIFY}\n\nOpen: {link}\n\nThis link expires in 48 hours."),
        html: format!(
            "<p>{SUBJECT_VERIFY}</p><p><a href=\"{link}\">Verify email</a></p><p>Expires in 48 hours.</p>"
        ),
        link,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_trailing_slash_safe() {
        assert_eq!(
            build_link("http://x.test/", "verify", "abc"),
            "http://x.test/?verify=abc"
        );
        assert_eq!(
            build_link("http://x.test", "verify", "abc"),
            "http://x.test/?verify=abc"
        );
    }

    #[test]
    fn tokens_are_url_encoded() {
        assert_eq!(urlencode("a+b/c=d"), "a%2Bb%2Fc%3Dd");
        assert_eq!(urlencode("plain-token_09"), "plain-token_09");
    }
}

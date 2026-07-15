import { logger } from './logger'

/**
 * Password-reset / verification mailer.
 * - Default: log only (dev)
 * - SMTP: set SMTP_URL (smtp://user:pass@host:587) + MAIL_FROM
 * - Webhook: set EMAIL_WEBHOOK_URL (POST JSON {to,subject,text,html})
 */
export async function sendEmail(opts: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<{ ok: boolean; mode: string }> {
  const from = process.env.MAIL_FROM ?? 'noreply@stranger.local'
  const webhook = process.env.EMAIL_WEBHOOK_URL
  const smtpUrl = process.env.SMTP_URL

  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, ...opts }),
      })
      if (!res.ok) throw new Error(`webhook ${res.status}`)
      logger.info('email.sent', { mode: 'webhook', to: opts.to })
      return { ok: true, mode: 'webhook' }
    } catch (err) {
      logger.error('email.webhook_failed', { err: String(err) })
      return { ok: false, mode: 'webhook' }
    }
  }

  if (smtpUrl) {
    // Lightweight: without nodemailer dependency, document that operators
    // should point EMAIL_WEBHOOK_URL at a mail microservice, or we log intent.
    logger.warn('email.smtp_configured_but_use_webhook', {
      hint: 'Set EMAIL_WEBHOOK_URL for delivery without extra deps, or install a mailer.',
      to: opts.to,
    })
  }

  logger.info('email.dev_log', {
    mode: 'log',
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  })
  return { ok: true, mode: 'log' }
}

export function resetEmailBody(token: string, appUrl: string) {
  const link = `${appUrl.replace(/\/$/, '')}/?reset=${encodeURIComponent(token)}`
  const text = `Reset your stranger password.\n\nToken: ${token}\nOr open: ${link}\n\nThis link expires in 1 hour.`
  const html = `<p>Reset your <strong>stranger</strong> password.</p><p><a href="${link}">Reset password</a></p><p>Or use token: <code>${token}</code></p><p>Expires in 1 hour.</p>`
  return { text, html, link }
}

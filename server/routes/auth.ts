import type { Hono } from 'hono'
import {
  createEmailVerificationToken,
  createSession,
  hashPassword,
  hashToken,
  isAdult,
  isBanned,
  publicUser,
  refreshSession,
  revokeSession,
  userFromToken,
  validCredentials,
  verifyEmailToken,
  verifyPassword,
} from '../auth'
import { db } from '../db'
import { resetEmailBody, sendEmail, verifyEmailBody } from '../email'
import { rateLimit, rateLimitHeaders, rateLimitInfo } from '../rateLimit'
import { getBearer, clientIp } from '../http'
import { inc } from '../metrics'
import { logger } from '../logger'
import { config } from '../config'
import {
  API_ROUTES,
  CONSENT_KIND,
  DEFAULT_COUNTRY,
  DEFAULT_GENDER,
  DEFAULT_LANGUAGE,
  EMAIL_SUBJECT,
  HTTP_STATUS,
  METRIC_NAMES,
  SERVER_ERROR_CODE,
} from '../../shared/constants'

export function registerAuthRoutes(app: Hono, appUrl: string) {
  app.post(API_ROUTES.authRegister, async (c) => {
    const ip = clientIp(c)
    const rl = rateLimitInfo(`register:${ip}`, 10, 15 * 60_000)
    if (!rl.ok) {
      return c.json({ error: 'Too many attempts. Try later.' }, HTTP_STATUS.tooManyRequests, rateLimitHeaders(rl))
    }
    inc(METRIC_NAMES.authRegisterAttempts)

    const body = await c.req.json<{
      email?: unknown
      password?: unknown
      birthDate?: unknown
      gender?: unknown
      country?: unknown
      language?: unknown
      interests?: unknown
    }>()
    const { email, password, birthDate } = body
    if (!validCredentials(email, password)) {
      return c.json({ error: 'Use a valid email and an 8+ character password.' }, HTTP_STATUS.badRequest)
    }
    if (typeof birthDate !== 'string' || !isAdult(birthDate)) {
      return c.json({ error: 'You must be 18 or older to register.' }, HTTP_STATUS.badRequest)
    }
    if (await isBanned(null, ip)) return c.json({ error: 'Access denied.' }, HTTP_STATUS.forbidden)

    const gender = typeof body.gender === 'string' ? body.gender : DEFAULT_GENDER
    const country = typeof body.country === 'string' ? body.country : DEFAULT_COUNTRY
    const language = typeof body.language === 'string' ? body.language : DEFAULT_LANGUAGE
    const interests = Array.isArray(body.interests) ? JSON.stringify(body.interests.slice(0, 10)) : '[]'

    try {
      await db.execute({
        sql: `INSERT INTO users (email, password_hash, birth_date, gender, country, language, interests)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [email.toLowerCase(), await hashPassword(String(password)), birthDate, gender, country, language, interests],
      })
      const idResult = await db.execute({
        sql: 'SELECT id FROM users WHERE email = ?',
        args: [email.toLowerCase()],
      })
      const userId = Number(idResult.rows[0]?.id)
      const token = await createSession(userId)
      await db.execute({
        sql: 'INSERT INTO consents (user_id, kind) VALUES (?, ?)',
        args: [userId, CONSENT_KIND.termsAge],
      })
      const verifyToken = await createEmailVerificationToken(userId)
      const mail = verifyEmailBody(verifyToken, appUrl)
      await sendEmail({
        to: email.toLowerCase(),
        subject: EMAIL_SUBJECT.verify,
        text: mail.text,
        html: mail.html,
      })
      const user = await userFromToken(token)
      inc(METRIC_NAMES.authRegisterOk)
      logger.info('auth.register', { userId })
      return c.json(
        {
          user: user ? publicUser(user) : null,
          token,
          ...(config.isProd ? {} : { devVerifyToken: verifyToken }),
        },
        201,
      )
    } catch {
      return c.json({ error: 'That email is already registered.' }, HTTP_STATUS.conflict)
    }
  })

  app.post(API_ROUTES.authVerifyEmail, async (c) => {
    const { token } = await c.req.json<{ token?: string }>()
    if (typeof token !== 'string' || !token) return c.json({ error: 'Invalid token.' }, HTTP_STATUS.badRequest)
    const ok = await verifyEmailToken(token)
    if (!ok) return c.json({ error: 'Invalid or expired token.' }, HTTP_STATUS.badRequest)
    inc(METRIC_NAMES.emailVerified)
    return c.json({ ok: true })
  })

  app.post(API_ROUTES.authResendVerification, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    if (user.email_verified) return c.json({ ok: true, already: true })
    const ip = clientIp(c)
    if (!rateLimit(`reverify:${ip}`, 5, 15 * 60_000)) return c.json({ error: 'Too many attempts.' }, HTTP_STATUS.tooManyRequests)
    const verifyToken = await createEmailVerificationToken(user.id)
    const mail = verifyEmailBody(verifyToken, appUrl)
    await sendEmail({ to: user.email, subject: EMAIL_SUBJECT.verify, text: mail.text, html: mail.html })
    return c.json({ ok: true, ...(config.isProd ? {} : { devVerifyToken: verifyToken }) })
  })

  app.post(API_ROUTES.authLogin, async (c) => {
    const ip = clientIp(c)
    const rl = rateLimitInfo(`login:${ip}`, 20, 15 * 60_000)
    if (!rl.ok) {
      return c.json({ error: 'Too many attempts. Try later.' }, HTTP_STATUS.tooManyRequests, rateLimitHeaders(rl))
    }
    inc(METRIC_NAMES.authLoginAttempts)

    const { email, password } = await c.req.json<{ email?: unknown; password?: unknown }>()
    if (!validCredentials(email, password)) return c.json({ error: 'Invalid email or password.' }, HTTP_STATUS.badRequest)

    const result = await db.execute({
      sql: 'SELECT id, password_hash, birth_date, email_verified FROM users WHERE email = ?',
      args: [email.toLowerCase()],
    })
    const row = result.rows[0]
    const hash = row?.password_hash
    if (typeof hash !== 'string' || !(await verifyPassword(String(password), hash))) {
      return c.json({ error: 'Invalid email or password.' }, HTTP_STATUS.unauthorized)
    }
    const userId = Number(row.id)
    if (await isBanned(userId, ip)) return c.json({ error: 'This account is banned.' }, HTTP_STATUS.forbidden)
    const birthDate = typeof row.birth_date === 'string' ? row.birth_date : null
    if (!birthDate || !isAdult(birthDate)) {
      return c.json({ error: 'Your account needs a valid 18+ birthday.' }, HTTP_STATUS.forbidden)
    }
    if (config.features.requireEmailVerified && !Number(row.email_verified)) {
      return c.json({ error: 'Verify your email before signing in.', code: SERVER_ERROR_CODE.emailUnverified }, HTTP_STATUS.forbidden)
    }
    const token = await createSession(userId)
    const user = await userFromToken(token)
    inc(METRIC_NAMES.authLoginOk)
    return c.json({ user: user ? publicUser(user) : null, token })
  })

  app.post(API_ROUTES.authLogout, async (c) => {
    const token = getBearer(c)
    if (token) await revokeSession(token)
    return c.json({ ok: true })
  })

  app.post(API_ROUTES.authRefresh, async (c) => {
    const token = getBearer(c)
    if (!token) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const next = await refreshSession(token)
    if (!next) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const user = await userFromToken(next)
    inc(METRIC_NAMES.authRefreshOk)
    return c.json({ token: next, user: user ? publicUser(user) : null })
  })

  app.get(API_ROUTES.authMe, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    return c.json({ user: publicUser(user) })
  })

  app.patch(API_ROUTES.authPreferences, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const body = await c.req.json<{
      gender?: string
      country?: string
      language?: string
      interests?: string[]
    }>()
    await db.execute({
      sql: `UPDATE users SET gender = COALESCE(?, gender), country = COALESCE(?, country),
            language = COALESCE(?, language), interests = COALESCE(?, interests) WHERE id = ?`,
      args: [
        body.gender ?? null,
        body.country ?? null,
        body.language ?? null,
        body.interests ? JSON.stringify(body.interests.slice(0, 10)) : null,
        user.id,
      ],
    })
    const updated = await userFromToken(getBearer(c))
    return c.json({ user: updated ? publicUser(updated) : null })
  })

  app.post(API_ROUTES.authPasswordResetRequest, async (c) => {
    const ip = clientIp(c)
    if (!rateLimit(`reset:${ip}`, 5, 15 * 60_000)) return c.json({ error: 'Too many attempts.' }, HTTP_STATUS.tooManyRequests)
    const { email } = await c.req.json<{ email?: string }>()
    let devResetToken: string | undefined
    if (typeof email === 'string') {
      const result = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] })
      const id = result.rows[0]?.id
      if (id != null) {
        const { randomBytes } = await import('node:crypto')
        const token = randomBytes(32).toString('base64url')
        const expires = new Date(Date.now() + 3600_000).toISOString()
        await db.execute({
          sql: 'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
          args: [Number(id), hashToken(token), expires],
        })
        const body = resetEmailBody(token, appUrl)
        await sendEmail({
          to: email.toLowerCase(),
          subject: EMAIL_SUBJECT.reset,
          text: body.text,
          html: body.html,
        })
        if (process.env.NODE_ENV !== 'production') devResetToken = token
        inc(METRIC_NAMES.passwordResetRequests)
      }
    }
    return c.json({ ok: true, ...(devResetToken ? { devResetToken } : {}) })
  })

  app.post(API_ROUTES.authPasswordResetConfirm, async (c) => {
    const { token, password } = await c.req.json<{ token?: string; password?: string }>()
    if (typeof token !== 'string' || typeof password !== 'string' || password.length < 8) {
      return c.json({ error: 'Invalid request.' }, HTTP_STATUS.badRequest)
    }
    const result = await db.execute({
      sql: `SELECT id, user_id FROM password_reset_tokens
            WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')`,
      args: [hashToken(token)],
    })
    const row = result.rows[0]
    if (!row) return c.json({ error: 'Invalid or expired token.' }, HTTP_STATUS.badRequest)
    await db.execute({
      sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
      args: [await hashPassword(password), Number(row.user_id)],
    })
    await db.execute({ sql: 'UPDATE password_reset_tokens SET used = 1 WHERE id = ?', args: [Number(row.id)] })
    await db.execute({ sql: 'UPDATE sessions SET revoked = 1 WHERE user_id = ?', args: [Number(row.user_id)] })
    inc(METRIC_NAMES.passwordResetOk)
    return c.json({ ok: true })
  })

  app.delete(API_ROUTES.authAccount, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    await db.execute({ sql: 'UPDATE sessions SET revoked = 1 WHERE user_id = ?', args: [user.id] })
    await db.execute({ sql: 'DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', args: [user.id, user.id] })
    await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.id] })
    return c.json({ ok: true })
  })
}

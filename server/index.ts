import { serve } from '@hono/node-server'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Server as HttpServer } from 'node:http'
import { join } from 'node:path'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { WebSocketServer, type WebSocket } from 'ws'
import { noteReport } from './alerts'
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
} from './auth'
import { openApiDocument } from './openapi'
import { requestIdMiddleware } from './requestId'
import { config } from './config'
import { db, migrate, tursoUrl } from './db'
import { resetEmailBody, sendEmail, verifyEmailBody } from './email'
import { logger } from './logger'
import {
  fullRemove,
  getMeta,
  getPartner,
  getPartnerUserId,
  getRoom,
  heartbeat,
  hydrateBlocks,
  joinQueue,
  leaveRoom,
  normalizePreferences,
  queueStats,
  removeFromQueue,
  send,
  blockPair,
  unblockPair,
  type SocketLike,
} from './matchmaking'
import { inc, prometheusText, snapshot } from './metrics'
import { rateLimit, rateLimitHeaders, rateLimitInfo } from './rateLimit'
import { requireAdmin, securityHeaders } from './security'
import { createStaticHandler } from './static'
import { getIceServers } from './turn'
import type { ClientMessage, ReportReason } from '../shared/types'
import {
  BAN_REASON_DEFAULT,
  BEARER_PREFIX,
  CONSENT_KIND,
  DEFAULT_LANGUAGE,
  EMAIL_SUBJECT,
  HTTP_HEADERS,
  METRIC_NAMES,
  MIME_TYPE,
  PEER_LEFT_REASON,
  REPORT_CSV_HEADERS,
  REPORT_STATUS_FILTER,
  SERVER_ERROR_CODE,
  WS_CLOSE_CODE,
  WS_MESSAGE_TYPE,
} from '../shared/constants'

await migrate()
{
  const blocks = await db.execute('SELECT blocker_id, blocked_id FROM blocks')
  hydrateBlocks(blocks.rows as unknown as Array<{ blocker_id: unknown; blocked_id: unknown }>)
  logger.info('db.migrated', {
    url: tursoUrl.startsWith('file:') ? 'local' : 'remote',
    blocks: blocks.rows.length,
  })
}

let draining = false
let dbOk = true

const app = new Hono()
const origins = config.corsOrigins
const appUrl = config.appUrl
const distDir = config.staticDir || join(process.cwd(), 'dist')
const publicDir = join(process.cwd(), 'public')
const serveStatic = createStaticHandler(distDir, publicDir)

app.use('*', requestIdMiddleware)
app.use('*', securityHeaders)
app.use('*', compress())
app.use(
  '/api/*',
  cors({
    origin: (origin) => (origins.includes(origin) || !origin ? origin || origins[0]! : origins[0]!),
    credentials: true,
  }),
)

app.get('/api/docs', (c) => c.json(openApiDocument(appUrl)))

const getBearer = (c: { req: { header: (n: string) => string | undefined } }) => {
  const h = c.req.header(HTTP_HEADERS.authorization)
  if (h?.startsWith(BEARER_PREFIX)) return h.slice(BEARER_PREFIX.length)
  return c.req.header(HTTP_HEADERS.xSessionToken) ?? null
}

const clientIp = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header(HTTP_HEADERS.xForwardedFor)?.split(',')[0]?.trim() ??
  c.req.header(HTTP_HEADERS.xRealIp) ??
  'unknown'

function resolveVersion(): string {
  if (process.env.npm_package_version) return process.env.npm_package_version
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
const APP_VERSION = resolveVersion()

app.get('/api/health', (c) => {
  const stats = queueStats()
  return c.json({
    ok: !draining && dbOk,
    version: APP_VERSION,
    draining,
    waiting: stats.waiting,
    online: stats.online,
    database: tursoUrl.startsWith('file:') ? 'local libSQL' : 'turso',
    turn: Boolean(process.env.TURN_SECRET && process.env.TURN_URLS),
    uptimeSec: Math.floor(process.uptime()),
    features: config.features,
  })
})

/** Liveness: process is up (k8s livenessProbe). */
app.get('/api/health/live', (c) => c.json({ ok: true, version: APP_VERSION }))

/** Readiness: accept traffic (k8s readinessProbe). */
app.get('/api/health/ready', async (c) => {
  if (draining) return c.json({ ok: false, reason: 'draining' }, 503)
  try {
    await db.execute('SELECT 1')
    dbOk = true
  } catch {
    dbOk = false
    return c.json({ ok: false, reason: 'database' }, 503)
  }
  return c.json({ ok: true })
})

app.get('/api/metrics', (c) => {
  if (!config.metricsPublic && !requireAdmin(c)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const stats = queueStats()
  return c.json({ ...snapshot(), queue: stats, draining })
})

app.get('/api/metrics/prometheus', (c) => {
  if (!config.metricsPublic && !requireAdmin(c)) {
    return c.text('Forbidden', 403)
  }
  const stats = queueStats()
  const body = prometheusText({
    queue_waiting: stats.waiting,
    queue_online: stats.online,
    draining: draining ? 1 : 0,
  })
  return c.body(body, 200, { [HTTP_HEADERS.contentType]: MIME_TYPE.prometheus })
})

app.get('/api/config/public', (c) =>
  c.json({
    features: {
      anonymousMatch: config.features.anonymousMatch,
      qualityTelemetry: config.features.qualityTelemetry,
    },
    turnConfigured: Boolean(process.env.TURN_SECRET && process.env.TURN_URLS),
  }),
)

app.get('/api/ice', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`ice:${ip}`, 30, 60_000)) return c.json({ error: 'Too many requests' }, 429)
  return c.json(getIceServers())
})

app.post('/api/auth/register', async (c) => {
  const ip = clientIp(c)
  const rl = rateLimitInfo(`register:${ip}`, 10, 15 * 60_000)
  if (!rl.ok) {
    return c.json({ error: 'Too many attempts. Try later.' }, 429, rateLimitHeaders(rl))
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
    return c.json({ error: 'Use a valid email and an 8+ character password.' }, 400)
  }
  if (typeof birthDate !== 'string' || !isAdult(birthDate)) {
    return c.json({ error: 'You must be 18 or older to register.' }, 400)
  }
  if (await isBanned(null, ip)) return c.json({ error: 'Access denied.' }, 403)

  const gender = typeof body.gender === 'string' ? body.gender : 'other'
  const country = typeof body.country === 'string' ? body.country : 'any'
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
    return c.json({ error: 'That email is already registered.' }, 409)
  }
})

app.post('/api/auth/verify-email', async (c) => {
  const { token } = await c.req.json<{ token?: string }>()
  if (typeof token !== 'string' || !token) return c.json({ error: 'Invalid token.' }, 400)
  const ok = await verifyEmailToken(token)
  if (!ok) return c.json({ error: 'Invalid or expired token.' }, 400)
  inc(METRIC_NAMES.emailVerified)
  return c.json({ ok: true })
})

app.post('/api/auth/resend-verification', async (c) => {
  const user = await userFromToken(getBearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (user.email_verified) return c.json({ ok: true, already: true })
  const ip = clientIp(c)
  if (!rateLimit(`reverify:${ip}`, 5, 15 * 60_000)) return c.json({ error: 'Too many attempts.' }, 429)
  const verifyToken = await createEmailVerificationToken(user.id)
  const mail = verifyEmailBody(verifyToken, appUrl)
  await sendEmail({ to: user.email, subject: EMAIL_SUBJECT.verify, text: mail.text, html: mail.html })
  return c.json({ ok: true, ...(config.isProd ? {} : { devVerifyToken: verifyToken }) })
})

app.post('/api/auth/login', async (c) => {
  const ip = clientIp(c)
  const rl = rateLimitInfo(`login:${ip}`, 20, 15 * 60_000)
  if (!rl.ok) {
    return c.json({ error: 'Too many attempts. Try later.' }, 429, rateLimitHeaders(rl))
  }
  inc(METRIC_NAMES.authLoginAttempts)

  const { email, password } = await c.req.json<{ email?: unknown; password?: unknown }>()
  if (!validCredentials(email, password)) return c.json({ error: 'Invalid email or password.' }, 400)

  const result = await db.execute({
    sql: 'SELECT id, password_hash, birth_date, email_verified FROM users WHERE email = ?',
    args: [email.toLowerCase()],
  })
  const row = result.rows[0]
  const hash = row?.password_hash
  if (typeof hash !== 'string' || !(await verifyPassword(String(password), hash))) {
    return c.json({ error: 'Invalid email or password.' }, 401)
  }
  const userId = Number(row.id)
  if (await isBanned(userId, ip)) return c.json({ error: 'This account is banned.' }, 403)
  const birthDate = typeof row.birth_date === 'string' ? row.birth_date : null
  if (!birthDate || !isAdult(birthDate)) {
    return c.json({ error: 'Your account needs a valid 18+ birthday.' }, 403)
  }
  if (config.features.requireEmailVerified && !Number(row.email_verified)) {
    return c.json({ error: 'Verify your email before signing in.', code: 'email_unverified' }, 403)
  }
  const token = await createSession(userId)
  const user = await userFromToken(token)
  inc(METRIC_NAMES.authLoginOk)
  return c.json({ user: user ? publicUser(user) : null, token })
})

app.post('/api/auth/logout', async (c) => {
  const token = getBearer(c)
  if (token) await revokeSession(token)
  return c.json({ ok: true })
})

app.post('/api/auth/refresh', async (c) => {
  const token = getBearer(c)
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const next = await refreshSession(token)
  if (!next) return c.json({ error: 'Unauthorized' }, 401)
  const user = await userFromToken(next)
  inc(METRIC_NAMES.authRefreshOk)
  return c.json({ token: next, user: user ? publicUser(user) : null })
})

app.get('/api/auth/me', async (c) => {
  const user = await userFromToken(getBearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  return c.json({ user: publicUser(user) })
})

app.patch('/api/auth/preferences', async (c) => {
  const user = await userFromToken(getBearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
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

app.post('/api/auth/password-reset/request', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`reset:${ip}`, 5, 15 * 60_000)) return c.json({ error: 'Too many attempts.' }, 429)
  const { email } = await c.req.json<{ email?: string }>()
  let devResetToken: string | undefined
  if (typeof email === 'string') {
    const result = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] })
    const id = result.rows[0]?.id
    if (id != null) {
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

app.post('/api/auth/password-reset/confirm', async (c) => {
  const { token, password } = await c.req.json<{ token?: string; password?: string }>()
  if (typeof token !== 'string' || typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Invalid request.' }, 400)
  }
  const result = await db.execute({
    sql: `SELECT id, user_id FROM password_reset_tokens
          WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')`,
    args: [hashToken(token)],
  })
  const row = result.rows[0]
  if (!row) return c.json({ error: 'Invalid or expired token.' }, 400)
  await db.execute({
    sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
    args: [await hashPassword(password), Number(row.user_id)],
  })
  await db.execute({ sql: 'UPDATE password_reset_tokens SET used = 1 WHERE id = ?', args: [Number(row.id)] })
  await db.execute({ sql: 'UPDATE sessions SET revoked = 1 WHERE user_id = ?', args: [Number(row.user_id)] })
  inc(METRIC_NAMES.passwordResetOk)
  return c.json({ ok: true })
})

app.post('/api/blocks', async (c) => {
  const user = await userFromToken(getBearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { blockedId } = await c.req.json<{ blockedId?: number }>()
  if (!blockedId || blockedId === user.id) return c.json({ error: 'Invalid target' }, 400)
  await db.execute({
    sql: 'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
    args: [user.id, blockedId],
  })
  blockPair(user.id, blockedId)
  return c.json({ ok: true })
})

app.get('/api/blocks', async (c) => {
  const user = await userFromToken(getBearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const result = await db.execute({
    sql: `SELECT b.blocked_id AS id, u.email, b.created_at
          FROM blocks b
          LEFT JOIN users u ON u.id = b.blocked_id
          WHERE b.blocker_id = ?
          ORDER BY b.id DESC`,
    args: [user.id],
  })
  return c.json({
    blocked: result.rows.map((r) => ({
      id: Number(r.id),
      email: typeof r.email === 'string' ? r.email : null,
      createdAt: typeof r.created_at === 'string' ? r.created_at : null,
    })),
  })
})

app.delete('/api/blocks/:id', async (c) => {
  const user = await userFromToken(getBearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const blockedId = Number(c.req.param('id'))
  if (!blockedId) return c.json({ error: 'Invalid id' }, 400)
  await db.execute({
    sql: 'DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?',
    args: [user.id, blockedId],
  })
  unblockPair(user.id, blockedId)
  return c.json({ ok: true })
})

app.post('/api/reports', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`report:${ip}`, 15, 60_000)) return c.json({ error: 'Too many reports' }, 429)
  const user = await userFromToken(getBearer(c))
  const body = await c.req.json<{ reason?: ReportReason; detail?: string; roomId?: string }>()
  const reasons: ReportReason[] = ['nudity', 'harassment', 'hate', 'spam', 'underage', 'violence', 'other']
  if (!body.reason || !reasons.includes(body.reason)) return c.json({ error: 'Invalid reason' }, 400)
  await db.execute({
    sql: 'INSERT INTO reports (reporter_id, reporter_session, room_id, reason, detail) VALUES (?, ?, ?, ?, ?)',
    args: [user?.id ?? null, ip, body.roomId ?? null, body.reason, body.detail?.slice(0, 500) ?? null],
  })
  inc(METRIC_NAMES.reportsTotal)
  void noteReport(body.reason)
  return c.json({ ok: true })
})

app.get('/api/admin/overview', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403)
  try {
    const stats = queueStats()
    const users = await db.execute('SELECT COUNT(*) AS n FROM users')
    const reports = await db.execute('SELECT COUNT(*) AS n FROM reports')
    let openReports = 0
    try {
      const open = await db.execute(
        `SELECT COUNT(*) AS n FROM reports WHERE COALESCE(status, ${REPORT_STATUS_FILTER.open}) = ${REPORT_STATUS_FILTER.open}`,
      )
      openReports = Number(open.rows[0]?.n ?? 0)
    } catch {
      openReports = Number(reports.rows[0]?.n ?? 0)
    }
    const bans = await db.execute(
      `SELECT COUNT(*) AS n FROM bans WHERE expires_at IS NULL OR expires_at > datetime('now')`,
    )
    let ratings = { count: 0, average: null as number | null }
    try {
      const ratingStats = await db.execute(`SELECT COUNT(*) AS n, AVG(score) AS avg_score FROM ratings`)
      const avg = ratingStats.rows[0]?.avg_score
      ratings = {
        count: Number(ratingStats.rows[0]?.n ?? 0),
        average: avg != null && avg !== '' ? Number(Number(avg).toFixed(2)) : null,
      }
    } catch {
      /* ratings table may be missing on old DBs */
    }
    let underageOpen = 0
    try {
      const u = await db.execute(
        `SELECT COUNT(*) AS n FROM reports WHERE reason = 'underage' AND COALESCE(status, ${REPORT_STATUS_FILTER.open}) = ${REPORT_STATUS_FILTER.open}`,
      )
      underageOpen = Number(u.rows[0]?.n ?? 0)
    } catch {
      /* ignore */
    }
    return c.json({
      queue: stats,
      users: Number(users.rows[0]?.n ?? 0),
      reports: Number(reports.rows[0]?.n ?? 0),
      openReports,
      underageOpen,
      activeBans: Number(bans.rows[0]?.n ?? 0),
      ratings,
      metrics: snapshot(),
      version: APP_VERSION,
    })
  } catch (err) {
    logger.error('admin.overview_failed', { err: String(err) })
    return c.json({ error: 'Overview failed' }, 500)
  }
})

app.get('/api/admin/reports', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403)
  const status = c.req.query('status')
  const result =
    status === REPORT_STATUS_FILTER.open || status === REPORT_STATUS_FILTER.resolved
      ? await db.execute({
          sql: 'SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT 200',
          args: [status],
        })
      : await db.execute('SELECT * FROM reports ORDER BY id DESC LIMIT 200')
  return c.json({ reports: result.rows })
})

app.patch('/api/admin/reports/:id', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ status?: string }>()
  if (!id || (body.status !== REPORT_STATUS_FILTER.open && body.status !== REPORT_STATUS_FILTER.resolved)) {
    return c.json({ error: 'Invalid request' }, 400)
  }
  await db.execute({ sql: 'UPDATE reports SET status = ? WHERE id = ?', args: [body.status, id] })
  return c.json({ ok: true })
})

app.get('/api/admin/reports.csv', async (c) => {
  if (!requireAdmin(c)) return c.text('Forbidden', 403)
  const result = await db.execute('SELECT * FROM reports ORDER BY id DESC LIMIT 1000')
  const headers = [...REPORT_CSV_HEADERS]
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const row of result.rows) {
    lines.push(headers.map((h) => escape((row as Record<string, unknown>)[h])).join(','))
  }
  return c.body(lines.join('\n') + '\n', 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="reports.csv"',
  })
})

app.post('/api/ratings', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`rating:${ip}`, 40, 60_000)) return c.json({ error: 'Too many requests' }, 429)
  const user = await userFromToken(getBearer(c))
  const body = await c.req.json<{ roomId?: string; score?: number }>()
  const score = Number(body.score)
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return c.json({ error: 'Score must be 1–5.' }, 400)
  }
  const roomId = body.roomId?.slice(0, 64) || `anon_${ip}_${Date.now()}`
  try {
    await db.execute({
      sql: 'INSERT INTO ratings (room_id, rater_id, rater_session, score) VALUES (?, ?, ?, ?)',
      args: [roomId, user?.id ?? null, ip, score],
    })
  } catch {
    return c.json({ error: 'Already rated this match.' }, 409)
  }
  inc(METRIC_NAMES.ratingsTotal)
  inc(`rating_score_${score}`)
  return c.json({ ok: true })
})

app.get('/api/admin/bans', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403)
  const result = await db.execute('SELECT * FROM bans ORDER BY id DESC LIMIT 200')
  return c.json({ bans: result.rows })
})

app.get('/api/admin/users', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403)
  const q = c.req.query('q')?.trim()
  if (q) {
    const result = await db.execute({
      sql: `SELECT id, email, birth_date, country, created_at FROM users
            WHERE email LIKE ? ORDER BY id DESC LIMIT 50`,
      args: [`%${q.toLowerCase()}%`],
    })
    return c.json({ users: result.rows })
  }
  const result = await db.execute(
    'SELECT id, email, birth_date, country, created_at FROM users ORDER BY id DESC LIMIT 50',
  )
  return c.json({ users: result.rows })
})

app.post('/api/admin/ban', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403)
  const body = await c.req.json<{ userId?: number; ip?: string; reason?: string; hours?: number }>()
  const expires = body.hours != null ? new Date(Date.now() + body.hours * 3600_000).toISOString() : null
  await db.execute({
    sql: 'INSERT INTO bans (user_id, ip, reason, expires_at) VALUES (?, ?, ?, ?)',
    args: [body.userId ?? null, body.ip ?? null, body.reason ?? BAN_REASON_DEFAULT, expires],
  })
  if (body.userId) {
    await db.execute({ sql: 'UPDATE sessions SET revoked = 1 WHERE user_id = ?', args: [body.userId] })
  }
  inc(METRIC_NAMES.bansTotal)
  logger.warn('admin.ban', { userId: body.userId, ip: body.ip, reason: body.reason })
  return c.json({ ok: true })
})

app.delete('/api/admin/ban/:id', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, 403)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'Invalid id' }, 400)
  await db.execute({ sql: 'DELETE FROM bans WHERE id = ?', args: [id] })
  return c.json({ ok: true })
})

app.delete('/api/auth/account', async (c) => {
  const user = await userFromToken(getBearer(c))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  await db.execute({ sql: 'UPDATE sessions SET revoked = 1 WHERE user_id = ?', args: [user.id] })
  await db.execute({ sql: 'DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', args: [user.id, user.id] })
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.id] })
  return c.json({ ok: true })
})

// Production: serve Vite build for SPA (including /admin)
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api') || c.req.path === '/ws') return c.notFound()
  const res = await serveStatic(c.req.path)
  if (res) return res
  return c.text('Not found — run npm run build or use Vite dev server', 404)
})

function asSocket(ws: WebSocket): SocketLike {
  return ws as unknown as SocketLike
}

async function handleWsMessage(ws: WebSocket, ip: string, sessionKey: string, raw: string) {
  const socket = asSocket(ws)
  let message: ClientMessage
  try {
    message = JSON.parse(raw) as ClientMessage
  } catch {
    return
  }

  if (message.type === WS_MESSAGE_TYPE.queueHeartbeat) {
    heartbeat(socket)
    return
  }

  if (message.type === WS_MESSAGE_TYPE.queueJoin || message.type === WS_MESSAGE_TYPE.roomNext) {
    if (draining) {
      send(socket, { type: WS_MESSAGE_TYPE.serverDraining, message: 'Server is restarting. Try again shortly.' })
      return
    }
    if (!rateLimit(`wsjoin:${ip}`, 40, 60_000)) {
      send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down.' })
      return
    }
    if (await isBanned(null, ip)) {
      send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.banned, message: 'Access denied.' })
      return
    }
    if (!config.features.anonymousMatch && !message.token) {
      send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to match.' })
      return
    }
    const prefs = normalizePreferences(message.preferences)
    if (!prefs) {
      send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Invalid preferences.' })
      return
    }
    let userId: number | undefined
    if (message.token) {
      const user = await userFromToken(message.token)
      if (user) {
        if (await isBanned(user.id, ip)) {
          send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.banned, message: 'Access denied.' })
          return
        }
        if (config.features.requireEmailVerified && !user.email_verified) {
          send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.emailUnverified, message: 'Verify your email first.' })
          return
        }
        userId = user.id
      }
    }
    if (message.type === WS_MESSAGE_TYPE.roomNext) {
      leaveRoom(socket, true, PEER_LEFT_REASON.next)
      inc(METRIC_NAMES.roomNext)
    }
    joinQueue(socket, prefs, { userId, sessionKey })
    return
  }

  if (message.type === WS_MESSAGE_TYPE.queueLeave || message.type === WS_MESSAGE_TYPE.roomLeave) {
    removeFromQueue(socket)
    leaveRoom(socket, true, PEER_LEFT_REASON.leave)
    return
  }

  if (message.type === WS_MESSAGE_TYPE.signal) {
    const partner = getPartner(socket)
    if (partner && message.payload) {
      send(partner, { type: WS_MESSAGE_TYPE.signal, payload: message.payload })
      inc(METRIC_NAMES.signalsRelayed)
    }
    return
  }

  if (message.type === WS_MESSAGE_TYPE.chat) {
    if (!rateLimit(`wschat:${ip}`, 30, 60_000)) {
      send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down chat.' })
      return
    }
    const partner = getPartner(socket)
    const text = message.payload?.text?.slice(0, 500)
    if (partner && text) {
      send(partner, {
        type: WS_MESSAGE_TYPE.chat,
        payload: { text, time: message.payload.time || new Date().toISOString() },
      })
      inc(METRIC_NAMES.chatsRelayed)
    }
    return
  }

  if (message.type === WS_MESSAGE_TYPE.report) {
    if (!rateLimit(`wsreport:${ip}`, 10, 60_000)) return
    if (!config.features.guestReports) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to report.' })
        return
      }
    }
    const room = getRoom(socket)
    const meta = getMeta(socket)
    await db.execute({
      sql: 'INSERT INTO reports (reporter_id, reporter_session, room_id, reason, detail) VALUES (?, ?, ?, ?, ?)',
      args: [
        meta?.userId ?? null,
        sessionKey,
        room?.id ?? null,
        message.reason,
        message.detail?.slice(0, 500) ?? null,
      ],
    })
    inc(METRIC_NAMES.reportsTotal)
    void noteReport(message.reason)
    const partner = getPartner(socket)
    leaveRoom(socket, true, PEER_LEFT_REASON.reported)
    send(socket, { type: WS_MESSAGE_TYPE.reportAck })
    if (partner) leaveRoom(partner, false)
    return
  }

  if (message.type === WS_MESSAGE_TYPE.block) {
    const meta = getMeta(socket)
    const peerId = getPartnerUserId(socket)
    if (meta?.userId && peerId) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
        args: [meta.userId, peerId],
      })
      blockPair(meta.userId, peerId)
      inc(METRIC_NAMES.blocksTotal)
    }
    const partner = getPartner(socket)
    leaveRoom(socket, true, PEER_LEFT_REASON.blocked)
    send(socket, { type: WS_MESSAGE_TYPE.blockAck })
    if (partner) leaveRoom(partner, false)
    return
  }

  if (message.type === WS_MESSAGE_TYPE.telemetryQuality) {
    if (!config.features.qualityTelemetry) return
    if (!rateLimit(`telemetry:${ip}`, 60, 60_000)) return
    inc(METRIC_NAMES.webrtcQuality(message.quality))
    logger.debug('webrtc.quality', {
      roomId: message.roomId,
      quality: message.quality,
      ice: message.iceState,
      conn: message.connectionState,
    })
  }
}

const port = config.port

const httpServer = serve({ fetch: app.fetch, port }, (info) => {
  logger.info('server.listen', { port: info.port, static: distDir, env: config.nodeEnv })
}) as HttpServer

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error('server.port_in_use', {
      port,
      hint: `Port ${port} is already taken (leftover dev server?). Free it with: npm run free-ports  (or: fuser -k ${port}/tcp)`,
    })
    process.exit(1)
  }
  logger.error('server.listen_error', { code: err.code, message: err.message })
  process.exit(1)
})

const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
// Listen errors also surface on the WebSocketServer when it shares the HTTP server.
wss.on('error', (err: Error) => {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE') {
    // httpServer handler already logs + exits; avoid unhandled 'error' crash noise.
    return
  }
  logger.error('ws.server_error', { message: err.message, code })
})

wss.on('connection', (ws, req) => {
  if (draining) {
    ws.send(JSON.stringify({ type: WS_MESSAGE_TYPE.serverDraining, message: 'Server is restarting.' }))
    ws.close(WS_CLOSE_CODE.serviceRestart, 'service restart')
    return
  }
  const ip =
    (req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown') ?? 'unknown'
  const sessionKey = createHash('sha256')
    .update(`${ip}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 16)
  inc(METRIC_NAMES.wsConnections)

  ws.on('message', (data) => {
    void handleWsMessage(ws, ip, sessionKey, String(data))
  })
  ws.on('close', () => fullRemove(asSocket(ws)))
  ws.on('error', () => fullRemove(asSocket(ws)))
})

let shuttingDown = false
const shutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  draining = true
  logger.info('server.draining', { signal, drainMs: config.drainMs })

  const payload = JSON.stringify({
    type: WS_MESSAGE_TYPE.serverDraining,
    message: 'Server is restarting. Please reconnect shortly.',
  })
  for (const client of wss.clients) {
    try {
      if (client.readyState === 1) client.send(payload)
    } catch {
      /* ignore */
    }
  }

  setTimeout(() => {
    logger.info('server.shutdown')
    wss.close()
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref?.()
  }, config.drainMs).unref?.()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))


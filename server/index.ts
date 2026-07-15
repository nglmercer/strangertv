import { serve, upgradeWebSocket } from '@hono/node-server'
import { randomBytes, createHash } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getConnInfo } from '@hono/node-server/conninfo'
import { WebSocketServer } from 'ws'
import {
  createSession,
  hashPassword,
  hashToken,
  isAdult,
  isBanned,
  publicUser,
  revokeSession,
  userFromToken,
  validCredentials,
  verifyPassword,
} from './auth'
import { db, migrate, tursoUrl } from './db'
import {
  fullRemove,
  getMeta,
  getPartner,
  getRoom,
  heartbeat,
  joinQueue,
  leaveRoom,
  normalizePreferences,
  queueStats,
  removeFromQueue,
  send,
  blockPair,
  type SocketLike,
} from './matchmaking'
import { rateLimit } from './rateLimit'
import { getIceServers } from './turn'
import type { ClientMessage, ReportReason } from '../shared/types'

await migrate()

const app = new Hono()
const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',')

app.use(
  '/api/*',
  cors({
    origin: (origin) => (origins.includes(origin) || !origin ? origin || origins[0]! : origins[0]!),
    credentials: true,
  }),
)

const getBearer = (c: { req: { header: (n: string) => string | undefined } }) => {
  const h = c.req.header('authorization')
  if (h?.startsWith('Bearer ')) return h.slice(7)
  return c.req.header('x-session-token') ?? null
}

const clientIp = (c: { req: { header: (n: string) => string | undefined } }) => {
  try {
    // @ts-expect-error conninfo needs full context in some versions
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  }
}

app.get('/api/health', (c) => {
  const stats = queueStats()
  return c.json({
    ok: true,
    waiting: stats.waiting,
    online: stats.online,
    database: tursoUrl.startsWith('file:') ? 'local libSQL' : 'turso',
    turn: Boolean(process.env.TURN_SECRET && process.env.TURN_URLS),
  })
})

app.get('/api/ice', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`ice:${ip}`, 30, 60_000)) return c.json({ error: 'Too many requests' }, 429)
  return c.json(getIceServers())
})

app.post('/api/auth/register', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`register:${ip}`, 10, 15 * 60_000)) return c.json({ error: 'Too many attempts. Try later.' }, 429)

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
  const language = typeof body.language === 'string' ? body.language : 'en'
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
      args: [userId, 'terms_age'],
    })
    const user = await userFromToken(token)
    return c.json({ user: user ? publicUser(user) : null, token }, 201)
  } catch {
    return c.json({ error: 'That email is already registered.' }, 409)
  }
})

app.post('/api/auth/login', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`login:${ip}`, 20, 15 * 60_000)) return c.json({ error: 'Too many attempts. Try later.' }, 429)

  const { email, password } = await c.req.json<{ email?: unknown; password?: unknown }>()
  if (!validCredentials(email, password)) return c.json({ error: 'Invalid email or password.' }, 400)

  const result = await db.execute({
    sql: 'SELECT id, password_hash, birth_date FROM users WHERE email = ?',
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
  const token = await createSession(userId)
  const user = await userFromToken(token)
  return c.json({ user: user ? publicUser(user) : null, token })
})

app.post('/api/auth/logout', async (c) => {
  const token = getBearer(c)
  if (token) await revokeSession(token)
  return c.json({ ok: true })
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
  // Always same response (no account enumeration)
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
      // Dev: return token so local testing works without email
      if (process.env.NODE_ENV !== 'production') {
        return c.json({ ok: true, devResetToken: token })
      }
    }
  }
  return c.json({ ok: true })
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
    sql: 'SELECT blocked_id FROM blocks WHERE blocker_id = ?',
    args: [user.id],
  })
  return c.json({ blocked: result.rows.map((r) => Number(r.blocked_id)) })
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
  return c.json({ ok: true })
})

app.get('/api/admin/reports', async (c) => {
  const key = c.req.header('x-admin-key')
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return c.json({ error: 'Forbidden' }, 403)
  const result = await db.execute('SELECT * FROM reports ORDER BY id DESC LIMIT 100')
  return c.json({ reports: result.rows })
})

app.post('/api/admin/ban', async (c) => {
  const key = c.req.header('x-admin-key')
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return c.json({ error: 'Forbidden' }, 403)
  const body = await c.req.json<{ userId?: number; ip?: string; reason?: string; hours?: number }>()
  const expires =
    body.hours != null ? new Date(Date.now() + body.hours * 3600_000).toISOString() : null
  await db.execute({
    sql: 'INSERT INTO bans (user_id, ip, reason, expires_at) VALUES (?, ?, ?, ?)',
    args: [body.userId ?? null, body.ip ?? null, body.reason ?? 'moderation', expires],
  })
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

// WebSocket signaling
app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const ip = (() => {
      try {
        return getConnInfo(c).remote.address ?? 'unknown'
      } catch {
        return 'unknown'
      }
    })()
    const sessionKey = createHash('sha256').update(`${ip}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)

    return {
      async onMessage(event, rawSocket) {
        const ws = rawSocket as unknown as SocketLike
        let message: ClientMessage
        try {
          message = JSON.parse(String(event.data)) as ClientMessage
        } catch {
          return
        }

        if (message.type === 'queue:heartbeat') {
          heartbeat(ws)
          return
        }

        if (message.type === 'queue:join' || message.type === 'room:next') {
          if (!rateLimit(`wsjoin:${ip}`, 40, 60_000)) {
            send(ws, { type: 'error', code: 'rate_limit', message: 'Slow down.' })
            return
          }
          if (await isBanned(null, ip)) {
            send(ws, { type: 'error', code: 'banned', message: 'Access denied.' })
            return
          }
          const prefs = normalizePreferences(message.preferences)
          if (!prefs) {
            send(ws, { type: 'error', code: 'bad_prefs', message: 'Invalid preferences.' })
            return
          }
          let userId: number | undefined
          if (message.token) {
            const user = await userFromToken(message.token)
            if (user) {
              if (await isBanned(user.id, ip)) {
                send(ws, { type: 'error', code: 'banned', message: 'Access denied.' })
                return
              }
              userId = user.id
            }
          }
          if (message.type === 'room:next') {
            leaveRoom(ws, true, 'next')
          }
          joinQueue(ws, prefs, { userId, sessionKey })
          return
        }

        if (message.type === 'queue:leave' || message.type === 'room:leave') {
          removeFromQueue(ws)
          leaveRoom(ws, true, 'leave')
          return
        }

        if (message.type === 'signal') {
          const partner = getPartner(ws)
          if (partner && message.payload) {
            send(partner, { type: 'signal', payload: message.payload })
          }
          return
        }

        if (message.type === 'chat') {
          const partner = getPartner(ws)
          const text = message.payload?.text?.slice(0, 500)
          if (partner && text) {
            send(partner, {
              type: 'chat',
              payload: { text, time: message.payload.time || new Date().toISOString() },
            })
          }
          return
        }

        if (message.type === 'report') {
          if (!rateLimit(`wsreport:${ip}`, 10, 60_000)) return
          const room = getRoom(ws)
          const meta = getMeta(ws)
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
          const partner = getPartner(ws)
          leaveRoom(ws, true, 'reported')
          send(ws, { type: 'report:ack' })
          if (partner) {
            leaveRoom(partner, false)
          }
          return
        }
      },
      onClose(_event, socket) {
        fullRemove(socket as unknown as SocketLike)
      },
      onError(_event, socket) {
        fullRemove(socket as unknown as SocketLike)
      },
    }
  }),
)

const wss = new WebSocketServer({ noServer: true })
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port, websocket: { server: wss } }, (info) => {
  console.log(`Stranger server listening on http://localhost:${info.port}`)
})

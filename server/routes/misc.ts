import type { Hono } from 'hono'
import { db } from '../db'
import { blockPair, unblockPair } from '../matchmaking'
import { userFromToken, publicUser, type UserRow } from '../auth'
import { rateLimit } from '../rateLimit'
import { getBearer, clientIp } from '../http'
import { inc } from '../metrics'
import { noteReport } from '../alerts'
import {
  API_ROUTES,
  HTTP_STATUS,
  METRIC_NAMES,
  REPORT_REASONS,
  REPORT_STATUS_FILTER,
} from '../../shared/constants'
import type { ReportReason } from '../../shared/types'

export function registerMiscRoutes(app: Hono) {
  // Blocks
  app.post(API_ROUTES.blocks, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const { blockedId } = await c.req.json<{ blockedId?: number }>()
    if (!blockedId || blockedId === user.id) return c.json({ error: 'Invalid target' }, HTTP_STATUS.badRequest)
    await db.execute({
      sql: 'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
      args: [user.id, blockedId],
    })
    blockPair(user.id, blockedId)
    return c.json({ ok: true })
  })

  app.get(API_ROUTES.blocks, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
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

  app.delete(API_ROUTES.blockById(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const blockedId = Number(c.req.param('id'))
    if (!blockedId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await db.execute({
      sql: 'DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?',
      args: [user.id, blockedId],
    })
    unblockPair(user.id, blockedId)
    return c.json({ ok: true })
  })

  // Reports
  app.post(API_ROUTES.reports, async (c) => {
    const ip = clientIp(c)
    if (!rateLimit(`report:${ip}`, 15, 60_000)) return c.json({ error: 'Too many reports' }, HTTP_STATUS.tooManyRequests)
    const user = await userFromToken(getBearer(c))
    const body = await c.req.json<{ reason?: ReportReason; detail?: string; roomId?: string }>()
    const reasons: ReportReason[] = [...REPORT_REASONS]
    if (!body.reason || !reasons.includes(body.reason)) return c.json({ error: 'Invalid reason' }, HTTP_STATUS.badRequest)
    await db.execute({
      sql: 'INSERT INTO reports (reporter_id, reporter_session, room_id, reason, detail) VALUES (?, ?, ?, ?, ?)',
      args: [user?.id ?? null, ip, body.roomId ?? null, body.reason, body.detail?.slice(0, 500) ?? null],
    })
    inc(METRIC_NAMES.reportsTotal)
    void noteReport(body.reason)
    return c.json({ ok: true })
  })

  // Ratings
  app.post(API_ROUTES.ratings, async (c) => {
    const ip = clientIp(c)
    if (!rateLimit(`rating:${ip}`, 40, 60_000)) return c.json({ error: 'Too many requests' }, HTTP_STATUS.tooManyRequests)
    const user = await userFromToken(getBearer(c))
    const body = await c.req.json<{ roomId?: string; score?: number }>()
    const score = Number(body.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return c.json({ error: 'Score must be 1–5.' }, HTTP_STATUS.badRequest)
    }
    const roomId = body.roomId?.slice(0, 64) || `anon_${ip}_${Date.now()}`
    try {
      await db.execute({
        sql: 'INSERT INTO ratings (room_id, rater_id, rater_session, score) VALUES (?, ?, ?, ?)',
        args: [roomId, user?.id ?? null, ip, score],
      })
    } catch {
      return c.json({ error: 'Already rated this match.' }, HTTP_STATUS.conflict)
    }
    inc(METRIC_NAMES.ratingsTotal)
    inc(`rating_score_${score}`)
    return c.json({ ok: true })
  })

  // Users search
  app.get(API_ROUTES.usersSearch, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const email = c.req.query('email')?.trim()
    if (!email) return c.json({ error: 'Email required' }, HTTP_STATUS.badRequest)
    const result = await db.execute({
      sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE email = ? AND id != ?',
      args: [email, user.id],
    })
    const row = result.rows[0]
    if (!row) return c.json({ user: null })
    return c.json({ user: publicUser(row as unknown as UserRow) })
  })
}

import type { Hono } from 'hono'
import { db } from '../db'
import { snapshot } from '../metrics'
import { requireAdmin } from '../security'
import { queueStats } from '../matchmaking'
import {
  API_ROUTES,
  BAN_REASON_DEFAULT,
  HTTP_HEADERS,
  HTTP_STATUS,
  METRIC_NAMES,
  MIME_TYPE,
  REPORT_CSV_HEADERS,
  REPORT_STATUS_FILTER,
} from '../../shared/constants'

export function registerAdminRoutes(app: Hono) {
  app.get(API_ROUTES.adminOverview, async (c) => {
    if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
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
        version: '0.0.0',
      })
    } catch (err) {
      return c.json({ error: 'Overview failed' }, HTTP_STATUS.internalServerError)
    }
  })

  app.get(API_ROUTES.adminReports, async (c) => {
    if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
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

  app.patch(API_ROUTES.adminReportById(':id'), async (c) => {
    if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
    const id = Number(c.req.param('id'))
    const body = await c.req.json<{ status?: string }>()
    if (!id || (body.status !== REPORT_STATUS_FILTER.open && body.status !== REPORT_STATUS_FILTER.resolved)) {
      return c.json({ error: 'Invalid request' }, HTTP_STATUS.badRequest)
    }
    await db.execute({ sql: 'UPDATE reports SET status = ? WHERE id = ?', args: [body.status, id] })
    return c.json({ ok: true })
  })

  app.get(API_ROUTES.adminReportsCsv, async (c) => {
    if (!requireAdmin(c)) return c.text('Forbidden', HTTP_STATUS.forbidden)
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
    return c.body(lines.join('\n') + '\n', HTTP_STATUS.ok, {
      [HTTP_HEADERS.contentType]: MIME_TYPE.csv,
      'content-disposition': 'attachment; filename="reports.csv"',
    })
  })

  app.get(API_ROUTES.adminBans, async (c) => {
    if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
    const result = await db.execute('SELECT * FROM bans ORDER BY id DESC LIMIT 200')
    return c.json({ bans: result.rows })
  })

  app.get(API_ROUTES.adminUsers, async (c) => {
    if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
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

  app.post(API_ROUTES.adminBan, async (c) => {
    if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
    const body = await c.req.json<{ userId?: number; ip?: string; reason?: string; hours?: number }>()
    const expires = body.hours != null ? new Date(Date.now() + body.hours * 3600_000).toISOString() : null
    await db.execute({
      sql: 'INSERT INTO bans (user_id, ip, reason, expires_at) VALUES (?, ?, ?, ?)',
      args: [body.userId ?? null, body.ip ?? null, body.reason ?? BAN_REASON_DEFAULT, expires],
    })
    if (body.userId) {
      await db.execute({ sql: 'UPDATE sessions SET revoked = 1 WHERE user_id = ?', args: [body.userId] })
    }
    return c.json({ ok: true })
  })

  app.delete(API_ROUTES.adminBanById(':id'), async (c) => {
    if (!requireAdmin(c)) return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
    const id = Number(c.req.param('id'))
    if (!id) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await db.execute({ sql: 'DELETE FROM bans WHERE id = ?', args: [id] })
    return c.json({ ok: true })
  })
}

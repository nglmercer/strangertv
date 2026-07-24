import type { Hono } from 'hono'
import { openApiDocument } from '../openapi'
import { db, tursoUrl } from '../db'
import { getIceServers } from '../turn'
import { inc, prometheusText, snapshot } from '../metrics'
import { rateLimit } from '../rateLimit'
import { requireAdmin } from '../security'
import { clientIp, resolveVersion } from '../http'
import { queueStats } from '../matchmaking'
import { config } from '../config'
import {
  API_ROUTES,
  HTTP_HEADERS,
  HTTP_STATUS,
  MIME_TYPE,
  WS_PATH,
  API_PREFIX,
} from '../../shared/constants'

const APP_VERSION = resolveVersion()

export function registerHealthRoutes(
  app: Hono,
  appUrl: string,
  isDraining?: () => boolean,
  dbOk?: { value: boolean },
) {
  app.get(API_ROUTES.docs, (c) => c.json(openApiDocument(appUrl)))

  app.get(API_ROUTES.health, (c) => {
    const stats = queueStats()
    return c.json({
      ok: !(isDraining?.() ?? false) && (dbOk?.value ?? true),
      version: APP_VERSION,
      draining: isDraining?.() ?? false,
      waiting: stats.waiting,
      online: stats.online,
      database: tursoUrl.startsWith('file:') ? 'local libSQL' : 'turso',
      turn: Boolean(process.env.TURN_SECRET && process.env.TURN_URLS),
      uptimeSec: Math.floor(process.uptime()),
      features: config.features,
    })
  })

  app.get(API_ROUTES.healthLive, (c) => c.json({ ok: true, version: APP_VERSION }))

  app.get(API_ROUTES.healthReady, async (c) => {
    if (isDraining?.()) return c.json({ ok: false, reason: 'draining' }, HTTP_STATUS.serviceUnavailable)
    try {
      await db.execute('SELECT 1')
      if (dbOk) dbOk.value = true
    } catch {
      if (dbOk) dbOk.value = false
      return c.json({ ok: false, reason: 'database' }, HTTP_STATUS.serviceUnavailable)
    }
    return c.json({ ok: true })
  })

  app.get(API_ROUTES.metrics, (c) => {
    if (!config.metricsPublic && !requireAdmin(c)) {
      return c.json({ error: 'Forbidden' }, HTTP_STATUS.forbidden)
    }
    const stats = queueStats()
    return c.json({ ...snapshot(), queue: stats, draining: isDraining?.() ?? false })
  })

  app.get(API_ROUTES.metricsPrometheus, (c) => {
    if (!config.metricsPublic && !requireAdmin(c)) {
      return c.text('Forbidden', HTTP_STATUS.forbidden)
    }
    const stats = queueStats()
    const body = prometheusText({
      queue_waiting: stats.waiting,
      queue_online: stats.online,
      draining: isDraining?.() ? 1 : 0,
    })
    return c.body(body, HTTP_STATUS.ok, { [HTTP_HEADERS.contentType]: MIME_TYPE.prometheus })
  })

  app.get(API_ROUTES.configPublic, (c) =>
    c.json({
      features: {
        anonymousMatch: config.features.anonymousMatch,
        qualityTelemetry: config.features.qualityTelemetry,
      },
      turnConfigured: Boolean(process.env.TURN_SECRET && process.env.TURN_URLS),
    }),
  )

  app.get(API_ROUTES.ice, async (c) => {
    const ip = clientIp(c)
    if (!rateLimit(`ice:${ip}`, 30, 60_000)) return c.json({ error: 'Too many requests' }, HTTP_STATUS.tooManyRequests)
    return c.json(getIceServers())
  })
}

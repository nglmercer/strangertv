import { serve } from '@hono/node-server'
import { createHash } from 'node:crypto'
import type { Server as HttpServer } from 'node:http'
import { join } from 'node:path'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { WebSocketServer, type WebSocket } from 'ws'
import { config } from './config'
import { db, migrate, tursoUrl } from './db'
import { logger } from './logger'
import { hydrateBlocks, send, fullRemove, type SocketLike } from './matchmaking'
import { inc } from './metrics'
import { requestIdMiddleware } from './requestId'
import { securityHeaders } from './security'
import { createStaticHandler } from './static'
import { ipFromReq, resolveVersion } from './http'
import {
  API_PREFIX,
  API_ROUTES,
  HTTP_STATUS,
  METRIC_NAMES,
  WS_CLOSE_CODE,
  WS_PATH,
} from '../shared/constants'
import { registerAuthRoutes } from './routes/auth'
import { registerSocialRoutes } from './routes/social'
import { registerMiscRoutes } from './routes/misc'
import { registerAdminRoutes } from './routes/admin'
import { registerHealthRoutes } from './routes/health'
import { createWsHandler, type WsState } from './ws/handlers'

// ---------------------------------------------------------------------------
// Database migration
// ---------------------------------------------------------------------------
await migrate()
{
  const blocks = await db.execute('SELECT blocker_id, blocked_id FROM blocks')
  hydrateBlocks(blocks.rows as unknown as Array<{ blocker_id: unknown; blocked_id: unknown }>)
  logger.info('db.migrated', {
    url: tursoUrl.startsWith('file:') ? 'local' : 'remote',
    blocks: blocks.rows.length,
  })
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let draining = false
const dbOk = { value: true }

const app = new Hono()
const origins = config.corsOrigins
const appUrl = config.appUrl
const distDir = config.staticDir || join(process.cwd(), 'dist')
const publicDir = join(process.cwd(), 'dist')
const serveStatic = createStaticHandler(distDir, publicDir)

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
registerHealthRoutes(app, appUrl, () => draining, dbOk)
registerAuthRoutes(app, appUrl)
registerSocialRoutes(app, send)
registerMiscRoutes(app)
registerAdminRoutes(app)

// Production: serve Vite build for SPA (including /admin)
app.get('*', async (c) => {
  if (c.req.path.startsWith(API_PREFIX) || c.req.path === WS_PATH) return c.notFound()
  const res = await serveStatic(c.req.path)
  if (res) return res
  return c.text('Not found — run npm run build or use Vite dev server', HTTP_STATUS.notFound)
})

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const wsState: WsState = { draining: { value: draining } }
const handleWsMessage = createWsHandler(wsState)

function asSocket(ws: WebSocket): SocketLike {
  return ws as unknown as SocketLike
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

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH })
wss.on('error', (err: Error) => {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE') return
  logger.error('ws.server_error', { message: err.message, code })
})

wss.on('connection', (ws, req) => {
  if (draining) {
    ws.send(JSON.stringify({ type: 'server:draining', message: 'Server is restarting.' }))
    ws.close(WS_CLOSE_CODE.serviceRestart, 'service restart')
    return
  }
  const ip = ipFromReq(req)
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

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let shuttingDown = false
const shutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  draining = true
  wsState.draining.value = true
  logger.info('server.draining', { signal, drainMs: config.drainMs })

  const payload = JSON.stringify({
    type: 'server:draining',
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

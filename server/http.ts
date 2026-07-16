import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type HeaderCtx = { req: { header: (n: string) => string | undefined } }

/** Resolve the API app version from env, then package.json, falling back to 0.0.0. */
export function resolveVersion(): string {
  if (process.env.npm_package_version) return process.env.npm_package_version
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Extract a bearer/session token from the standard auth headers. */
export function getBearer(c: HeaderCtx): string | null {
  const h = c.req.header(HTTP_HEADERS_AUTHORIZATION)
  if (h?.startsWith(BEARER_PREFIX)) return h.slice(BEARER_PREFIX.length)
  return c.req.header(HTTP_HEADERS_X_SESSION) ?? null
}

/** Best-effort client IP from proxy headers, falling back to 'unknown'. */
export function clientIp(c: HeaderCtx): string {
  return (
    c.req.header(HTTP_HEADERS_XFF)?.split(',')[0]?.trim() ??
    c.req.header(HTTP_HEADERS_X_REAL_IP) ??
    'unknown'
  )
}

/** Client IP from a raw incoming HTTP request (used by the WS upgrade path). */
export function ipFromReq(req: {
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}): string {
  const xff = req.headers[HTTP_HEADERS_XFF]
  const xffStr = Array.isArray(xff) ? xff[0] : xff
  const realIp = req.headers[HTTP_HEADERS_X_REAL_IP]
  const realIpStr = Array.isArray(realIp) ? realIp[0] : realIp
  return (
    xffStr?.toString().split(',')[0]?.trim() ||
    realIpStr?.toString() ||
    req.socket?.remoteAddress ||
    'unknown'
  )
}

const HTTP_HEADERS_AUTHORIZATION = 'authorization'
const HTTP_HEADERS_X_SESSION = 'x-session-token'
const HTTP_HEADERS_XFF = 'x-forwarded-for'
const HTTP_HEADERS_X_REAL_IP = 'x-real-ip'
const BEARER_PREFIX = 'Bearer '

import type { Context, Next } from 'hono'
import { HTTP_HEADERS } from '../shared/constants'

export async function securityHeaders(c: Context, next: Next) {
  await next()
  c.res.headers.set(HTTP_HEADERS.xContentTypeOptions, 'nosniff')
  c.res.headers.set(HTTP_HEADERS.xFrameOptions, 'DENY')
  c.res.headers.set(HTTP_HEADERS.referrerPolicy, 'strict-origin-when-cross-origin')
  c.res.headers.set(HTTP_HEADERS.permissionsPolicy, 'camera=(self), microphone=(self), geolocation=()')
  if (process.env.NODE_ENV === 'production') {
    c.res.headers.set(HTTP_HEADERS.strictTransportSecurity, 'max-age=31536000; includeSubDomains')
    // Allow same-origin WS + media; tighten further behind a reverse proxy if needed
    c.res.headers.set(
      HTTP_HEADERS.contentSecurityPolicy,
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "media-src 'self' blob:",
        "frame-ancestors 'none'",
      ].join('; '),
    )
  }
}

export function requireAdmin(c: Context): boolean {
  const key = c.req.header(HTTP_HEADERS.xAdminKey)
  return Boolean(process.env.ADMIN_KEY && key === process.env.ADMIN_KEY)
}

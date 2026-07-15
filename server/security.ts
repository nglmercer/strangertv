import type { Context, Next } from 'hono'

export async function securityHeaders(c: Context, next: Next) {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
  if (process.env.NODE_ENV === 'production') {
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    // Allow same-origin WS + media; tighten further behind a reverse proxy if needed
    c.res.headers.set(
      'Content-Security-Policy',
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
  const key = c.req.header('x-admin-key')
  return Boolean(process.env.ADMIN_KEY && key === process.env.ADMIN_KEY)
}

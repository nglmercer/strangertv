import { randomBytes } from 'node:crypto'
import type { Context, Next } from 'hono'
import { HTTP_HEADERS } from '../shared/constants'

export async function requestIdMiddleware(c: Context, next: Next) {
  const incoming = c.req.header(HTTP_HEADERS.xRequestId)
  const id = incoming && incoming.length <= 64 ? incoming : randomBytes(8).toString('hex')
  c.set('requestId' as never, id as never)
  await next()
  c.res.headers.set(HTTP_HEADERS.xRequestId, id)
}

export function getRequestId(c: Context): string {
  try {
    return String(c.get('requestId' as never) ?? '')
  } catch {
    return ''
  }
}

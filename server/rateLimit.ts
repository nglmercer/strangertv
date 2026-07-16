import { HTTP_HEADERS } from '../shared/constants'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export type RateLimitResult = {
  ok: boolean
  limit: number
  remaining: number
  resetAt: number
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  return rateLimitInfo(key, limit, windowMs).ok
}

export function rateLimitInfo(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now > bucket.resetAt) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt })
    return { ok: true, limit, remaining: limit - 1, resetAt }
  }
  if (bucket.count >= limit) {
    return { ok: false, limit, remaining: 0, resetAt: bucket.resetAt }
  }
  bucket.count += 1
  return { ok: true, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt }
}

export function rateLimitHeaders(info: RateLimitResult): Record<string, string> {
  return {
    [HTTP_HEADERS.xRateLimitLimit]: String(info.limit),
    [HTTP_HEADERS.xRateLimitRemaining]: String(info.remaining),
    [HTTP_HEADERS.xRateLimitReset]: String(Math.ceil(info.resetAt / 1000)),
  }
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key)
  }
}, 60_000).unref?.()

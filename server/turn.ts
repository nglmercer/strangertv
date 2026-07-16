import { createHmac, randomBytes } from 'node:crypto'
import { STUN_SERVERS } from '../shared/constants'

/**
 * Optional TURN: set TURN_SECRET + TURN_URLS (comma-separated).
 * Uses time-limited credentials (coturn REST style).
 */
export function getIceServers() {
  const stun = STUN_SERVERS.map((url) => ({ urls: url }))
  const secret = process.env.TURN_SECRET
  const urls = (process.env.TURN_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!secret || !urls.length) {
    return { iceServers: stun, ttl: 0 }
  }

  const ttl = 3600
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${randomBytes(4).toString('hex')}`
  const credential = createHmac('sha1', secret).update(username).digest('base64')

  return {
    iceServers: [
      ...stun,
      {
        urls,
        username,
        credential,
      },
    ],
    ttl,
  }
}

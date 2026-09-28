import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { spawnServer, stopServer, testDbUrl, waitHealthy } from './helpers/server'
import { API_ROUTES } from '../shared/constants'

/**
 * Anonymous matchmaking pool: guests may queue by default (the
 * FEATURE_ANONYMOUS_MATCH default is on), match each other from forced
 * default filters, and meet an authenticated user only when that user's
 * pool filter is open (`matchPool: "all"`).
 */

const PORT = 8806
const BASE = `http://127.0.0.1:${PORT}`
const WS_URL = `ws://127.0.0.1:${PORT}/ws`
const SECRET = 'test-secret-that-is-at-least-32-bytes-long'

type Registration = { token: string; user: { id: number; email: string } }

const basePrefs = {
  country: 'any',
  language: 'any',
  gender: 'any',
  lookingFor: 'any',
  interests: [],
  allowMatchWithSameUsers: true,
  mode: 'solo',
  matchScope: 'all',
  matchPool: 'all',
}

type Frame = { type: string; [k: string]: unknown }

/** Open a socket and send queue:join with the given prefs, optionally authenticated. */
function queueJoin(prefs: Record<string, unknown>, token?: string) {
  return new Promise<{
    ws: WebSocket
    frames: Frame[]
    waitFor: (type: string, ms?: number) => Promise<Frame>
  }>((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    const frames: Frame[] = []
    ws.onmessage = (ev) => frames.push(JSON.parse(String(ev.data)) as Frame)
    ws.onopen = () => {
      ws.send(
        JSON.stringify(
          token
            ? { type: 'queue:join', preferences: prefs, token }
            : { type: 'queue:join', preferences: prefs },
        ),
      )
      resolve({ ws, frames, waitFor })
    }
    ws.onerror = () => reject(new Error('ws error'))
    const waitFor = (type: string, ms = 5000) =>
      new Promise<Frame>((res, rej) => {
        const found = frames.find((f) => f.type === type)
        if (found) {
          res(found)
          return
        }
        const t = setTimeout(
          () => rej(new Error(`timeout waiting for ${type}: ${JSON.stringify(frames)}`)),
          ms,
        )
        const handler = (ev: MessageEvent) => {
          const msg = JSON.parse(String(ev.data)) as Frame
          if (msg.type === type) {
            clearTimeout(t)
            ws.removeEventListener('message', handler)
            res(msg)
          }
        }
        ws.addEventListener('message', handler)
      })
  })
}

describe('anonymous matchmaking pool', () => {
  let child: ChildProcess
  let databaseUrl: string
  let adult!: Registration
  let strictAdult!: Registration

  // FEATURE_ANONYMOUS_MATCH is deliberately unset: the default (on) is
  // what this suite holds the server to.
  const serverEnv = () => ({
    PORT: String(PORT),
    ADMIN_KEY: 'anon-pool-admin',
    NODE_ENV: 'test',
    REGISTER_RATE_LIMIT: '1000',
    BETTER_AUTH_SECRET: SECRET,
    TURSO_DATABASE_URL: databaseUrl,
  })

  const register = async (tag: string): Promise<Registration> => {
    const res = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `anonpool_${tag}_${Date.now()}@example.com`,
        password: 'password12',
        birthDate: '1990-02-02',
      }),
    })
    expect(res.status).toBe(201)
    return (await res.json()) as Registration
  }

  beforeAll(async () => {
    databaseUrl = testDbUrl('match-anon-pool')
    execFileSync('cargo', ['run', '--quiet', '--bin', 'migrate-auth'], {
      cwd: 'rust',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TURSO_DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: SECRET,
      },
      stdio: 'ignore',
    })
    child = spawnServer(serverEnv())
    await waitHealthy(BASE)

    adult = await register('adult')
    strictAdult = await register('strict')
  })

  afterAll(async () => {
    await stopServer(child)
  })

  it('two guests match by default', async () => {
    const a = await queueJoin(basePrefs)
    const b = await queueJoin(basePrefs)
    try {
      const [matchA, matchB] = await Promise.all([
        a.waitFor('room:matched'),
        b.waitFor('room:matched'),
      ])
      expect(matchA.roomId).toBeTruthy()
      expect(matchA.roomId).toBe(matchB.roomId)
      expect(new Set([matchA.role, matchB.role])).toEqual(new Set(['offerer', 'answerer']))
    } finally {
      a.ws.close()
      b.ws.close()
    }
  })

  it('guest filters are forced to defaults', async () => {
    // Mutually exclusive filters that could never match if honored.
    const a = await queueJoin({
      ...basePrefs,
      country: 'PE',
      language: 'es',
      lookingFor: 'female',
      interests: ['music'],
    })
    const b = await queueJoin({
      ...basePrefs,
      country: 'US',
      language: 'en',
      lookingFor: 'male',
      interests: ['tech'],
    })
    try {
      const [matchA, matchB] = await Promise.all([
        a.waitFor('room:matched'),
        b.waitFor('room:matched'),
      ])
      expect(matchA.roomId).toBe(matchB.roomId)
    } finally {
      a.ws.close()
      b.ws.close()
    }
  })

  it('an authenticated user with the default pool matches a guest', async () => {
    const authed = await queueJoin(basePrefs, adult.token)
    const guest = await queueJoin(basePrefs)
    try {
      const [matchA, matchG] = await Promise.all([
        authed.waitFor('room:matched'),
        guest.waitFor('room:matched'),
      ])
      expect(matchA.roomId).toBe(matchG.roomId)
    } finally {
      authed.ws.close()
      guest.ws.close()
    }
  })

  it('a registered-only user never meets a guest', async () => {
    const authed = await queueJoin({ ...basePrefs, matchPool: 'registered' }, strictAdult.token)
    const guest = await queueJoin(basePrefs)
    try {
      await authed.waitFor('queue:waiting')
      await guest.waitFor('queue:waiting')
      // Matching runs synchronously on join: if they were compatible they
      // would already be paired, so a short settle window proves the split.
      await sleep(1500)
      expect(authed.frames.some((f) => f.type === 'room:matched')).toBe(false)
      expect(guest.frames.some((f) => f.type === 'room:matched')).toBe(false)

      // The guest is matchable — just not with the registered-only user.
      const guest2 = await queueJoin(basePrefs)
      try {
        const [matchG, matchG2] = await Promise.all([
          guest.waitFor('room:matched'),
          guest2.waitFor('room:matched'),
        ])
        expect(matchG.roomId).toBe(matchG2.roomId)
        expect(authed.frames.some((f) => f.type === 'room:matched')).toBe(false)
      } finally {
        guest2.ws.close()
      }
    } finally {
      authed.ws.close()
      guest.ws.close()
    }
  })
})

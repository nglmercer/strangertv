import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, type ChildProcess } from 'node:child_process'
import { spawnServer, stopServer, testDbUrl, waitHealthy } from './helpers/server'
import { API_ROUTES, SERVER_ERROR_CODE } from '../shared/constants'

/**
 * Matchmaking age gate: video matchmaking requires an authenticated user
 * whose server-stored birth date proves 18+. Under-18 and unknown-age users
 * are rejected with a clear error, and anonymous users are rejected while
 * the anonymous-match flag is off (the default).
 */

const PORT = 8802
const BASE = `http://127.0.0.1:${PORT}`
const WS_URL = `ws://127.0.0.1:${PORT}/ws`
const SECRET = 'test-secret-that-is-at-least-32-bytes-long'

type Registration = { token: string; user: { id: number; email: string } }

const prefs = {
  country: 'any',
  language: 'any',
  gender: 'any',
  lookingFor: 'any',
  interests: [],
  allowMatchWithSameUsers: true,
  mode: 'solo',
  matchScope: 'all',
}

type Frame = { type: string; [k: string]: unknown }

/** Open a socket and send queue:join, optionally authenticated. */
function queueJoin(token?: string) {
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

describe('matchmaking age gate', () => {
  let child: ChildProcess
  let databaseUrl: string
  let adultA!: Registration
  let adultB!: Registration
  let underage!: Registration
  let unknownAge!: Registration

  // FEATURE_ANONYMOUS_MATCH is deliberately unset: the default (off) is
  // what this suite holds the server to.
  const serverEnv = () => ({
    PORT: String(PORT),
    ADMIN_KEY: 'age-gate-admin',
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
        email: `age_${tag}_${Date.now()}@example.com`,
        password: 'password12',
        birthDate: '1990-02-02',
      }),
    })
    expect(res.status).toBe(201)
    return (await res.json()) as Registration
  }

  beforeAll(async () => {
    databaseUrl = testDbUrl('match-age-gate')
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

    adultA = await register('adult_a')
    adultB = await register('adult_b')
    underage = await register('underage')
    unknownAge = await register('unknown')

    // Registration enforces the age gate, so rewrite the stored profiles
    // afterwards. Stop the server first so the mutation cannot race its
    // libSQL connection. The registration tokens stay valid: token lookup
    // is age-agnostic and the gate lives at matchmaking entry.
    await stopServer(child)
    const dbPath = databaseUrl.replace(/^file:/, '')
    execFileSync('sqlite3', [
      dbPath,
      `UPDATE users SET birth_date = '2015-06-15' WHERE email = '${underage.user.email}'`,
    ])
    execFileSync('sqlite3', [
      dbPath,
      `UPDATE users SET birth_date = NULL WHERE email = '${unknownAge.user.email}'`,
    ])
    child = spawnServer(serverEnv())
    await waitHealthy(BASE)
  })

  afterAll(async () => {
    await stopServer(child)
  })

  it('authenticated adults join the queue and match', async () => {
    const a = await queueJoin(adultA.token)
    const b = await queueJoin(adultB.token)
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

  it('under-18 users cannot join matchmaking', async () => {
    const client = await queueJoin(underage.token)
    try {
      const error = await client.waitFor('error')
      expect(error.code).toBe(SERVER_ERROR_CODE.ageRestricted)
      expect(String(error.message)).toContain('18')
      expect(client.frames.some((f) => f.type === 'room:matched')).toBe(false)
    } finally {
      client.ws.close()
    }
  })

  it('unknown-age users cannot join matchmaking', async () => {
    const client = await queueJoin(unknownAge.token)
    try {
      const error = await client.waitFor('error')
      expect(error.code).toBe(SERVER_ERROR_CODE.ageRestricted)
      expect(client.frames.some((f) => f.type === 'room:matched')).toBe(false)
    } finally {
      client.ws.close()
    }
  })

  it('anonymous users cannot join while the flag is off', async () => {
    const client = await queueJoin()
    try {
      const error = await client.waitFor('error')
      expect(error.code).toBe(SERVER_ERROR_CODE.authRequired)
      expect(client.frames.some((f) => f.type === 'room:matched')).toBe(false)
    } finally {
      client.ws.close()
    }
  })

  it('guests cannot redeem group-match invites', async () => {
    const ws = new WebSocket(WS_URL)
    try {
      const error = await new Promise<Frame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 5000)
        ws.onopen = () => {
          // No token: the auth gate fires before the room is even looked up,
          // so the room id is irrelevant.
          ws.send(JSON.stringify({ type: 'group-match:join', roomId: 'no-such-room' }))
        }
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as Frame
          if (msg.type === 'error') {
            clearTimeout(timer)
            resolve(msg)
          }
        }
        ws.onerror = () => reject(new Error('ws error'))
      })
      expect(error.code).toBe(SERVER_ERROR_CODE.authRequired)
    } finally {
      ws.close()
    }
  })
})

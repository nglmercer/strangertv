import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { type ChildProcess } from 'node:child_process'
import { spawnServer, stopServer, testDbUrl, waitHealthy } from './helpers/server'
import { API_ROUTES } from '../shared/constants'

const PORT = 8800
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_KEY = 'auth-policy-admin'
const BETTER_AUTH_SECRET = 'test-secret-that-is-at-least-32-bytes-long'

type Registration = {
  token: string
  user: { id: number; email: string }
}

describe('login policy ordering', () => {
  let child: ChildProcess
  let databaseUrl: string

  const serverEnv = () => ({
    PORT: String(PORT),
    ADMIN_KEY,
    NODE_ENV: 'test',
    REGISTER_RATE_LIMIT: '1000',
    FEATURE_REQUIRE_EMAIL_VERIFIED: 'true',
    BETTER_AUTH_SECRET,
    TURSO_DATABASE_URL: databaseUrl,
  })

  const start = async () => {
    child = spawnServer(serverEnv())
    await waitHealthy(BASE)
  }

  const register = async (tag: string, birthDate = '1990-02-02'): Promise<Registration> => {
    const res = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `policy_${tag}_${Date.now()}@example.com`,
        password: 'password12',
        birthDate,
      }),
    })
    expect(res.status).toBe(201)
    return (await res.json()) as Registration
  }

  const login = (email: string, password: string) =>
    fetch(`${BASE}${API_ROUTES.authLogin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

  beforeAll(async () => {
    databaseUrl = testDbUrl('auth-policy')
    execFileSync('cargo', ['run', '--quiet', '--bin', 'migrate-auth'], {
      cwd: 'rust',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TURSO_DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET,
      },
      stdio: 'ignore',
    })
    await start()
  })

  afterAll(async () => {
    await stopServer(child)
  })

  it('does not disclose a banned account before password verification', async () => {
    const reg = await register('banned')
    const email = reg.user.email
    const users = await fetch(`${BASE}${API_ROUTES.adminBan}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ userId: reg.user.id, reason: 'test', hours: 1 }),
    })
    expect(users.status).toBe(200)

    const wrong = await login(email, 'definitely-wrong-password')
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'Invalid email or password.' })

    const correct = await login(email, 'password12')
    expect(correct.status).toBe(403)
    expect(await correct.json()).toEqual({ error: 'This account is banned.' })
  })

  it('does not disclose email-verification state before password verification', async () => {
    const email = `unverified_${Date.now()}@example.com`
    const res = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-02-02' }),
    })
    expect(res.status).toBe(201)

    const wrong = await login(email, 'definitely-wrong-password')
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'Invalid email or password.' })

    const correct = await login(email, 'password12')
    expect(correct.status).toBe(403)
    expect(await correct.json()).toEqual({
      error: 'Verify your email before signing in.',
      code: 'email_unverified',
    })
  })

  it('does not disclose invalid age before password verification', async () => {
    const registration = await register('underage')
    const email = registration.user.email

    // Registration enforces the age gate, so alter the persisted profile only
    // after the account exists. Stop the server first so the mutation cannot
    // race the server's libSQL connection.
    await stopServer(child)
    const databasePath = databaseUrl.replace(/^file:/, '')
    execFileSync('sqlite3', [
      databasePath,
      `UPDATE users SET birth_date = '2015-01-01' WHERE email = '${email}'`,
    ])
    await start()

    const wrong = await login(email, 'definitely-wrong-password')
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'Invalid email or password.' })

    const correct = await login(email, 'password12')
    expect(correct.status).toBe(403)
    expect(await correct.json()).toEqual({
      error: 'Your account needs a valid 18+ birthday.',
    })
  })
})

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`

async function waitHealthy(ms = 15_000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${BASE}/api/health/live`)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await sleep(200)
  }
  throw new Error('server did not become healthy')
}

describe('API integration', () => {
  let child: ChildProcess

  before(async () => {
    child = spawn('npx', ['tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        ADMIN_KEY: 'itest-admin',
        NODE_ENV: 'test',
        TURSO_DATABASE_URL: 'file:itest.db',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitHealthy()
  })

  after(async () => {
    child.kill('SIGTERM')
    await sleep(300)
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  })

  it('health ready', async () => {
    const res = await fetch(`${BASE}/api/health/ready`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { ok: boolean }
    assert.equal(body.ok, true)
  })

  it('register login me logout', async () => {
    const email = `it_${Date.now()}@example.com`
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-02-02' }),
    })
    assert.equal(reg.status, 201)
    const regBody = (await reg.json()) as { token: string; user: { email: string } }
    assert.equal(regBody.user.email, email)

    const me = await fetch(`${BASE}/api/auth/me`, {
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    assert.equal(me.status, 200)

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12' }),
    })
    assert.equal(login.status, 200)

    const out = await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    assert.equal(out.status, 200)
  })

  it('admin requires key', async () => {
    const denied = await fetch(`${BASE}/api/admin/overview`)
    assert.equal(denied.status, 403)
    const ok = await fetch(`${BASE}/api/admin/overview`, {
      headers: { 'x-admin-key': 'itest-admin' },
    })
    assert.equal(ok.status, 200)
  })

  it('health includes version and ratings accept scores', async () => {
    const health = await fetch(`${BASE}/api/health`)
    const h = (await health.json()) as { version?: string }
    assert.ok(h.version)

    const bad = await fetch(`${BASE}/api/ratings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 9 }),
    })
    assert.equal(bad.status, 400)

    const roomId = `room_test_${Date.now()}`
    const ok = await fetch(`${BASE}/api/ratings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 5, roomId }),
    })
    assert.equal(ok.status, 200)

    const dup = await fetch(`${BASE}/api/ratings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 4, roomId }),
    })
    assert.equal(dup.status, 409)

    const overview = await fetch(`${BASE}/api/admin/overview`, {
      headers: { 'x-admin-key': 'itest-admin' },
    })
    const ov = (await overview.json()) as {
      ratings?: { count: number; average: number | null }
      openReports?: number
    }
    assert.ok(ov.ratings && ov.ratings.count >= 1)
    assert.ok(typeof ov.openReports === 'number')
  })
})

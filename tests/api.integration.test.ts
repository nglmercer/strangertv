import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { API_ROUTES } from '../shared/constants'

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`

async function waitHealthy(ms = 15_000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${BASE}${API_ROUTES.healthLive}`)
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

  beforeAll(async () => {
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
    const res = await fetch(`${BASE}${API_ROUTES.healthReady}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('register login me logout', async () => {
    const email = `it_${Date.now()}@example.com`
    const reg = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-02-02' }),
    })
    expect(reg.status).toBe(201)
    const regBody = (await reg.json()) as { token: string; user: { email: string } }
    expect(regBody.user.email).toBe(email)

    const me = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    expect(me.status).toBe(200)

    const login = await fetch(`${BASE}${API_ROUTES.authLogin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12' }),
    })
    expect(login.status).toBe(200)

    const out = await fetch(`${BASE}${API_ROUTES.authLogout}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    expect(out.status).toBe(200)
  })

  it('admin requires key', async () => {
    const denied = await fetch(`${BASE}${API_ROUTES.adminOverview}`)
    expect(denied.status).toBe(403)
    const ok = await fetch(`${BASE}${API_ROUTES.adminOverview}`, {
      headers: { 'x-admin-key': 'itest-admin' },
    })
    expect(ok.status).toBe(200)
  })

  it('friend messaging: send and fetch conversation', async () => {
    // Register user A
    const emailA = `msg_a_${Date.now()}@example.com`
    const regA = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: 'password12', birthDate: '1990-01-01' }),
    })
    expect(regA.status).toBe(201)
    const bodyA = (await regA.json()) as { token: string }

    // Register user B
    const emailB = `msg_b_${Date.now()}@example.com`
    const regB = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: 'password12', birthDate: '1990-01-01' }),
    })
    expect(regB.status).toBe(201)
    const bodyB = (await regB.json()) as { token: string; user: { id: number } }

    // A sends friend request
    const reqRes = await fetch(`${BASE}${API_ROUTES.friendsRequest}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ userId: bodyB.user.id }),
    })
    expect(reqRes.status).toBe(200)

    // A tries to message before acceptance — should fail
    const earlyMsg = await fetch(`${BASE}${API_ROUTES.messages}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ friendId: bodyB.user.id, text: 'before accept' }),
    })
    expect(earlyMsg.status).toBe(403)

    // B accepts friend request
    const friendsRes = await fetch(`${BASE}${API_ROUTES.friends}`, {
      headers: { authorization: `Bearer ${bodyB.token}` },
    })
    const friendsBody = (await friendsRes.json()) as { friends: Array<{ id: number }> }
    expect(friendsBody.friends.length).toBe(1)
    const friendId = friendsBody.friends[0].id

    const acceptRes = await fetch(`${BASE}${API_ROUTES.friendById(friendId, 'accept')}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${bodyB.token}` },
    })
    expect(acceptRes.status).toBe(200)

    // A sends message to B
    const sendRes = await fetch(`${BASE}${API_ROUTES.messages}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ friendId: bodyB.user.id, text: 'hello friend' }),
    })
    expect(sendRes.status).toBe(200)
    const sendBody = (await sendRes.json()) as { message: { id: number; text: string } }
    expect(sendBody.message.text).toBe('hello friend')

    // B fetches conversation
    const convRes = await fetch(`${BASE}${API_ROUTES.messages}?friendId=${bodyB.user.id}`, {
      headers: { authorization: `Bearer ${bodyA.token}` },
    })
    expect(convRes.status).toBe(200)
    const convBody = (await convRes.json()) as { messages: Array<{ text: string }> }
    expect(convBody.messages.length).toBe(1)
    expect(convBody.messages[0].text).toBe('hello friend')

    // Unauthenticated request fails
    const noAuth = await fetch(`${BASE}${API_ROUTES.messages}?friendId=${bodyB.user.id}`)
    expect(noAuth.status).toBe(401)

    // Message to non-friend fails
    const emailC = `msg_c_${Date.now()}@example.com`
    const regC = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailC, password: 'password12', birthDate: '1990-01-01' }),
    })
    const bodyC = (await regC.json()) as { user: { id: number } }
    const nonFriend = await fetch(`${BASE}${API_ROUTES.messages}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ friendId: bodyC.user.id, text: 'should fail' }),
    })
    expect(nonFriend.status).toBe(403)
  })

  it('follow messaging: send and fetch works for follows', async () => {
    // Register user A and B
    const emailA = `flw_a_${Date.now()}@example.com`
    const regA = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: 'password12', birthDate: '1990-01-01' }),
    })
    expect(regA.status).toBe(201)
    const bodyA = (await regA.json()) as { token: string }

    const emailB = `flw_b_${Date.now()}@example.com`
    const regB = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: 'password12', birthDate: '1990-01-01' }),
    })
    expect(regB.status).toBe(201)
    const bodyB = (await regB.json()) as { token: string; user: { id: number } }

    // A follows B (no friendship needed)
    const followRes = await fetch(`${BASE}${API_ROUTES.follows}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ userId: bodyB.user.id }),
    })
    expect(followRes.status).toBe(200)

    // A can message B because of follow relationship
    const sendRes = await fetch(`${BASE}${API_ROUTES.messages}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ friendId: bodyB.user.id, text: 'hey from follow' }),
    })
    expect(sendRes.status).toBe(200)

    // A can fetch conversation
    const convRes = await fetch(`${BASE}${API_ROUTES.messages}?friendId=${bodyB.user.id}`, {
      headers: { authorization: `Bearer ${bodyA.token}` },
    })
    expect(convRes.status).toBe(200)
    const convBody = (await convRes.json()) as { messages: Array<{ text: string }> }
    expect(convBody.messages.length).toBe(1)
    expect(convBody.messages[0].text).toBe('hey from follow')
  })

  it('self-messaging: send and fetch own messages', async () => {
    const email = `self_${Date.now()}@example.com`
    const reg = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-01-01' }),
    })
    expect(reg.status).toBe(201)
    const body = (await reg.json()) as { token: string; user: { id: number } }

    // Send message to self
    const sendRes = await fetch(`${BASE}${API_ROUTES.messages}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${body.token}` },
      body: JSON.stringify({ friendId: body.user.id, text: 'my reminder' }),
    })
    expect(sendRes.status).toBe(200)

    // Fetch self-conversation
    const convRes = await fetch(`${BASE}${API_ROUTES.messages}?friendId=${body.user.id}`, {
      headers: { authorization: `Bearer ${body.token}` },
    })
    expect(convRes.status).toBe(200)
    const convBody = (await convRes.json()) as { messages: Array<{ text: string }> }
    expect(convBody.messages.length).toBe(1)
    expect(convBody.messages[0].text).toBe('my reminder')
  })

  it('health includes version and ratings accept scores', async () => {
    const health = await fetch(`${BASE}${API_ROUTES.health}`)
    const h = (await health.json()) as { version?: string }
    expect(h.version).toBeTruthy()

    const bad = await fetch(`${BASE}${API_ROUTES.ratings}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 9 }),
    })
    expect(bad.status).toBe(400)

    const roomId = `room_test_${Date.now()}`
    const ok = await fetch(`${BASE}${API_ROUTES.ratings}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 5, roomId }),
    })
    expect(ok.status).toBe(200)

    const dup = await fetch(`${BASE}${API_ROUTES.ratings}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 4, roomId }),
    })
    expect(dup.status).toBe(409)

    const overview = await fetch(`${BASE}${API_ROUTES.adminOverview}`, {
      headers: { 'x-admin-key': 'itest-admin' },
    })
    const ov = (await overview.json()) as {
      ratings?: { count: number; average: number | null }
      openReports?: number
    }
    expect(ov.ratings && ov.ratings.count).toBeGreaterThanOrEqual(1)
    expect(typeof ov.openReports).toBe('number')
  })
})

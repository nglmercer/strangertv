import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawnServer, waitHealthy, stopServer, testDbUrl } from './helpers/server'
import { type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { API_ROUTES } from '../shared/constants'
import WebSocket from 'ws'

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`


describe('API integration', () => {
  let child: ChildProcess

  beforeAll(async () => {
    const databaseUrl = testDbUrl('itest')
    execFileSync('cargo', ['run', '--quiet', '--bin', 'migrate-auth'], {
      cwd: 'rust',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TURSO_DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-bytes-long',
      },
      stdio: 'ignore',
    })
    child = spawnServer({
      PORT: String(PORT),
      ADMIN_KEY: 'itest-admin',
      NODE_ENV: 'test',
      REGISTER_RATE_LIMIT: '1000',
      BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-bytes-long',
      TURSO_DATABASE_URL: databaseUrl,
    })
    await waitHealthy(BASE)
  })

  afterAll(async () => {
    await stopServer(child)
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
    const registrationCookie = reg.headers.get('set-cookie')?.split(';', 1)[0]
    expect(registrationCookie).toContain('better-auth.session_token=')

    const cookieMe = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { cookie: registrationCookie! },
    })
    expect(cookieMe.status).toBe(200)

    const me = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    expect(me.status).toBe(200)
    const migrationMetrics = await fetch(BASE + API_ROUTES.metrics, {
      headers: { 'x-admin-key': 'itest-admin' },
    })
    expect(migrationMetrics.status).toBe(200)
    const metricsBody = (await migrationMetrics.json()) as {
      counters?: Record<string, number>
    }
    expect(metricsBody.counters?.legacy_session_fallback).toBeGreaterThan(0)

    const login = await fetch(`${BASE}${API_ROUTES.authLogin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12' }),
    })
    expect(login.status).toBe(200)
    const loginCookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    expect(loginCookie).toContain('better-auth.session_token=')

    const cookieLoginMe = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { cookie: loginCookie! },
    })
    expect(cookieLoginMe.status).toBe(200)

    const resetRequest = await fetch(`${BASE}${API_ROUTES.authPasswordResetRequest}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    expect(resetRequest.status).toBe(200)
    const resetBody = (await resetRequest.json()) as { devResetToken?: string }
    expect(resetBody.devResetToken).toBeTruthy()
    const resetConfirm = await fetch(`${BASE}${API_ROUTES.authPasswordResetConfirm}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: resetBody.devResetToken, password: 'newpassword12' }),
    })
    expect(resetConfirm.status).toBe(200)
    const revokedLegacy = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    expect(revokedLegacy.status).toBe(401)
    const revokedCookie = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { cookie: loginCookie! },
    })
    expect(revokedCookie.status).toBe(401)

    const postResetLogin = await fetch(BASE + API_ROUTES.authLogin, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'newpassword12' }),
    })
    expect(postResetLogin.status).toBe(200)
    const postResetCookie = postResetLogin.headers.get('set-cookie')?.split(';', 1)[0]
    expect(postResetCookie).toContain('better-auth.session_token=')

    const out = await fetch(`${BASE}${API_ROUTES.authLogout}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${regBody.token}`, cookie: loginCookie! },
    })
    expect(out.status).toBe(200)

    const postResetOut = await fetch(BASE + API_ROUTES.authLogout, {
      method: 'POST',
      headers: { cookie: postResetCookie! },
    })
    expect(postResetOut.status).toBe(200)
    expect(postResetOut.headers.get('set-cookie')).toContain('Max-Age=0')
    const loggedOut = await fetch(BASE + API_ROUTES.authMe, {
      headers: { cookie: postResetCookie! },
    })
    expect(loggedOut.status).toBe(401)
  })

  it('Better Auth cookie logout revokes the compatibility bearer session', async () => {
    const email = `cookie_logout_${Date.now()}@example.com`
    const reg = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-02-02' }),
    })
    expect(reg.status).toBe(201)

    const signedIn = await fetch(`${BASE}${API_ROUTES.authLogin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12' }),
    })
    expect(signedIn.status).toBe(200)
    const signedInBody = (await signedIn.json()) as { token: string; session: string }
    expect(signedInBody.session).toBe('better-auth')
    const cookie = signedIn.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toContain('better-auth.session_token=')

    const beforeLogout = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { authorization: `Bearer ${signedInBody.token}` },
    })
    expect(beforeLogout.status).toBe(200)

    const openSocket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: cookie! },
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out opening authenticated WebSocket')), 5000)
      openSocket.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      openSocket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })

    const logout = await fetch(`${BASE}${API_ROUTES.authLogout}`, {
      method: 'POST',
      headers: { cookie: cookie! },
    })
    expect(logout.status).toBe(200)

    const cookieAfterLogout = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { cookie: cookie! },
    })
    expect(cookieAfterLogout.status).toBe(401)
    const bearerAfterLogout = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { authorization: `Bearer ${signedInBody.token}` },
    })
    expect(bearerAfterLogout.status).toBe(401)

    const socketAfterLogout = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for post-logout WebSocket auth result')), 5000)
      openSocket.once('message', (data) => {
        clearTimeout(timer)
        resolve(JSON.parse(String(data)) as Record<string, unknown>)
      })
      openSocket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    openSocket.send(JSON.stringify({
      type: 'group-match:create',
      visibility: 'public',
      preferences: {
        country: 'any',
        language: 'any',
        gender: 'any',
        lookingFor: 'any',
        interests: [],
        allowMatchWithSameUsers: true,
        mode: 'group',
        matchScope: 'all',
      },
    }))
    expect(await socketAfterLogout).toMatchObject({ type: 'error', code: 'auth_required' })
    openSocket.close()
  })

  it('admin requires key', async () => {
    const denied = await fetch(`${BASE}${API_ROUTES.adminOverview}`)
    expect(denied.status).toBe(403)
    const ok = await fetch(`${BASE}${API_ROUTES.adminOverview}`, {
      headers: { 'x-admin-key': 'itest-admin' },
    })
    expect(ok.status).toBe(200)
  })

  it('deletes both Better Auth and legacy identities through cookie auth', async () => {
    const email = `delete_${Date.now()}@example.com`
    const reg = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-02-02' }),
    })
    expect(reg.status).toBe(201)
    const regBody = (await reg.json()) as { token: string }
    const cookie = reg.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toContain('better-auth.session_token=')

    const deleted = await fetch(`${BASE}${API_ROUTES.authAccount}`, {
      method: 'DELETE',
      headers: { cookie: cookie! },
    })
    expect(deleted.status).toBe(200)

    const me = await fetch(`${BASE}${API_ROUTES.authMe}`, { headers: { cookie: cookie! } })
    expect(me.status).toBe(401)
    const legacyMe = await fetch(`${BASE}${API_ROUTES.authMe}`, {
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    expect(legacyMe.status).toBe(401)
    const login = await fetch(`${BASE}${API_ROUTES.authLogin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12' }),
    })
    expect(login.status).toBe(401)
  })

  it('authenticates a WebSocket upgrade with the Better Auth cookie', async () => {
    const email = 'ws_cookie_' + Date.now() + '@example.com'
    const reg = await fetch(BASE + API_ROUTES.authRegister, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-02-02' }),
    })
    expect(reg.status).toBe(201)
    const cookie = reg.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toContain('better-auth.session_token=')

    const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws', {
        headers: { Cookie: cookie!, Origin: 'http://localhost:5173' },
      })
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('timed out waiting for cookie-authenticated WebSocket'))
      }, 5000)
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'group-match:create',
          visibility: 'public',
          preferences: {
            country: 'any',
            language: 'any',
            gender: 'any',
            lookingFor: 'any',
            interests: [],
            allowMatchWithSameUsers: true,
            mode: 'group',
            matchScope: 'all',
          },
        }))
      })
      ws.on('message', (data) => {
        const next = JSON.parse(String(data)) as Record<string, unknown>
        if (next.type !== 'group-match:created') return
        clearTimeout(timer)
        ws.close()
        resolve(next)
      })
      ws.on('error', (error) => {
        clearTimeout(timer)
        ws.close()
        reject(error)
      })
    })
    expect(message.type).toBe('group-match:created')

    const rejectedStatus = await new Promise<number>((resolve, reject) => {
      let settled = false
      const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws', {
        headers: { Cookie: cookie!, Origin: 'https://attacker.example' },
      })
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }
      ws.once('unexpected-response', (_request, response) => {
        if (settled) return
        settled = true
        resolve(response.statusCode ?? 0)
        ws.close()
      })
      ws.once('open', () => fail(new Error('attacker Origin unexpectedly upgraded')))
      ws.once('error', (error) => fail(error))
    })
    expect(rejectedStatus).toBe(403)
  })

  it('re-establishes a WebSocket after a guest-to-cookie login transition', async () => {
    const email = `ws_transition_${Date.now()}@example.com`
    const reg = await fetch(BASE + API_ROUTES.authRegister, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12', birthDate: '1990-02-02' }),
    })
    expect(reg.status).toBe(201)
    const registrationCookie = reg.headers.get('set-cookie')?.split(';', 1)[0]
    expect(registrationCookie).toContain('better-auth.session_token=')

    // End the registration session so the next socket is an actual guest.
    const loggedOut = await fetch(BASE + API_ROUTES.authLogout, {
      method: 'POST',
      headers: { cookie: registrationCookie! },
    })
    expect(loggedOut.status).toBe(200)

    const guestSocket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out opening guest WebSocket')), 5000)
      guestSocket.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      guestSocket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })

    const login = await fetch(BASE + API_ROUTES.authLogin, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password12' }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toContain('better-auth.session_token=')

    // The old guest connection cannot receive a browser cookie after its
    // handshake. The client must close it and open a new cookie-authenticated
    // connection before sending an auth-required operation.
    guestSocket.close()
    await new Promise<void>((resolve) => guestSocket.once('close', () => resolve()))

    const authenticatedSocket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: cookie!, Origin: 'http://localhost:5173' },
    })
    const created = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for transitioned WebSocket auth')), 5000)
      authenticatedSocket.once('message', (data) => {
        clearTimeout(timer)
        resolve(JSON.parse(String(data)) as Record<string, unknown>)
      })
      authenticatedSocket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    await new Promise<void>((resolve, reject) => {
      authenticatedSocket.once('open', () => resolve())
      authenticatedSocket.once('error', reject)
    })
    authenticatedSocket.send(JSON.stringify({
      type: 'group-match:create',
      visibility: 'public',
      preferences: {
        country: 'any',
        language: 'any',
        gender: 'any',
        lookingFor: 'any',
        interests: [],
        allowMatchWithSameUsers: true,
        mode: 'group',
        matchScope: 'all',
      },
    }))
    expect(await created).toMatchObject({ type: 'group-match:created' })
    authenticatedSocket.close()
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
  it('leaving a group: last admin hands the role over, last member dissolves it', async () => {
    const stamp = Date.now()
    const reg = async (tag: string) => {
      const res = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `leave_${tag}_${stamp}@example.com`, password: 'password12', birthDate: '1990-01-01' }),
      })
      expect(res.status).toBe(201)
      return (await res.json()) as { token: string; user: { id: number } }
    }
    const auth = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` })

    const admin = await reg('admin')
    const member = await reg('member')

    const created = await fetch(`${BASE}${API_ROUTES.groups}`, {
      method: 'POST',
      headers: auth(admin.token),
      body: JSON.stringify({ name: 'Leavers', memberIds: [member.user.id] }),
    })
    expect(created.status).toBe(201)
    const { group } = (await created.json()) as { group: { id: number } }

    // The only admin can leave; the remaining member is promoted.
    const left = await fetch(`${BASE}${API_ROUTES.groupLeave(group.id)}`, { method: 'POST', headers: auth(admin.token) })
    expect(left.status).toBe(200)

    const memberGroups = (await (await fetch(`${BASE}${API_ROUTES.groups}`, { headers: auth(member.token) })).json()) as {
      groups: Array<{ id: number; myRole: string; memberCount: number }>
    }
    const survivor = memberGroups.groups.find((g) => g.id === group.id)
    expect(survivor?.myRole).toBe('admin')
    expect(survivor?.memberCount).toBe(1)

    // The last member leaving removes the group entirely.
    const last = await fetch(`${BASE}${API_ROUTES.groupLeave(group.id)}`, { method: 'POST', headers: auth(member.token) })
    expect(last.status).toBe(200)
    const after = (await (await fetch(`${BASE}${API_ROUTES.groups}`, { headers: auth(member.token) })).json()) as {
      groups: Array<{ id: number }>
    }
    expect(after.groups.some((g) => g.id === group.id)).toBe(false)
  })
})

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawnServer, waitHealthy, stopServer, testDbUrl } from './helpers/server'
import { type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { API_ROUTES } from '../shared/constants'
import WebSocket from 'ws'

const PORT = 8805
const BASE = `http://127.0.0.1:${PORT}`

type SuiteUser = { token: string; user: { id: number } }

describe('Activities integration', () => {
  let child: ChildProcess
  // Suite-level users: one registration costs ~10s against the debug binary
  // (scrypt + Better Auth work), so the suite registers once and each test
  // builds its own groups on top.
  let users: SuiteUser[] = []

  beforeAll(async () => {
    const databaseUrl = testDbUrl('activities')
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
    const stamp = Date.now()
    for (const tag of ['a', 'b', 'c', 'd']) {
      const res = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `act_${tag}_${stamp}@example.com`, password: 'password12', birthDate: '1990-01-01' }),
      })
      expect(res.status).toBe(201)
      users.push((await res.json()) as SuiteUser)
    }
  })

  afterAll(async () => {
    await stopServer(child)
  })

  const auth = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` })

  const makeGroup = async (token: string, memberIds: number[]) => {
    const res = await fetch(`${BASE}${API_ROUTES.groups}`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ name: 'Gamers', memberIds }),
    })
    expect(res.status).toBe(201)
    return ((await res.json()) as { group: { id: number } }).group
  }

  const catalogId = async (token: string) => {
    const { activities } = (await (
      await fetch(`${BASE}${API_ROUTES.activities}`, { headers: auth(token) })
    ).json()) as { activities: Array<{ id: number }> }
    return activities[0]!.id
  }

  it('catalog requires auth and seeds tic-tac-toe', async () => {
    const anon = await fetch(`${BASE}${API_ROUTES.activities}`)
    expect(anon.status).toBe(401)

    const res = await fetch(`${BASE}${API_ROUTES.activities}`, { headers: auth(users[0]!.token) })
    expect(res.status).toBe(200)
    const { activities } = (await res.json()) as {
      activities: Array<{ id: number; slug: string; entryUrl: string; maxPlayers: number }>
    }
    const game = activities.find((a) => a.slug === 'tictactoe')
    expect(game?.entryUrl).toBe('/activities/tictactoe')
    expect(game?.maxPlayers).toBe(2)
  })

  it('launch and instance lists require group membership', async () => {
    const [host, member, outsider] = [users[0]!, users[1]!, users[2]!]
    const group = await makeGroup(host.token, [member.user.id])
    const gameId = await catalogId(host.token)

    const denied = await fetch(`${BASE}${API_ROUTES.activityLaunch(gameId)}`, {
      method: 'POST',
      headers: auth(outsider.token),
      body: JSON.stringify({ groupId: group.id }),
    })
    expect(denied.status).toBe(400)

    const launched = await fetch(`${BASE}${API_ROUTES.activityLaunch(gameId)}`, {
      method: 'POST',
      headers: auth(host.token),
      body: JSON.stringify({ groupId: group.id }),
    })
    expect(launched.status).toBe(201)
    const { instance } = (await launched.json()) as { instance: { id: number; status: string } }
    expect(instance.status).toBe('active')

    const listed = await fetch(`${BASE}${API_ROUTES.activityInstances(group.id)}`, {
      headers: auth(member.token),
    })
    expect(listed.status).toBe(200)
    const { instances } = (await listed.json()) as { instances: Array<{ id: number }> }
    expect(instances.some((i) => i.id === instance.id)).toBe(true)

    const hidden = await fetch(`${BASE}${API_ROUTES.activityInstances(group.id)}`, {
      headers: auth(outsider.token),
    })
    expect(hidden.status).toBe(400)
  })

  it('codes are single-use and bound to their instance', async () => {
    const [a, b] = [users[0]!, users[1]!]
    const group = await makeGroup(a.token, [b.user.id])
    const gameId = await catalogId(a.token)

    const launch = async () =>
      (
        (await (
          await fetch(`${BASE}${API_ROUTES.activityLaunch(gameId)}`, {
            method: 'POST',
            headers: auth(a.token),
            body: JSON.stringify({ groupId: group.id }),
          })
        ).json()) as { instance: { id: number } }
      ).instance.id
    const first = await launch()
    const second = await launch()

    const join = await fetch(`${BASE}${API_ROUTES.activityInstanceJoin(first)}`, {
      method: 'POST',
      headers: auth(b.token),
    })
    expect(join.status).toBe(200)
    const { code } = (await join.json()) as { code: string }
    expect(code.length).toBeGreaterThan(20)

    const cross = await fetch(`${BASE}${API_ROUTES.activityInstanceToken(second)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(cross.status).toBe(400)

    // The exchange carries no session: code only, like the iframe does it.
    const exchanged = await fetch(`${BASE}${API_ROUTES.activityInstanceToken(first)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(exchanged.status).toBe(200)
    const { token } = (await exchanged.json()) as { token: string }
    expect(token.length).toBeGreaterThan(20)

    const replay = await fetch(`${BASE}${API_ROUTES.activityInstanceToken(first)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(replay.status).toBe(400)
  })

  it('game identity is user-info-only and rejects session credentials', async () => {
    const [a, b] = [users[0]!, users[3]!]
    const group = await makeGroup(a.token, [b.user.id])
    const gameId = await catalogId(a.token)

    const launched = await fetch(`${BASE}${API_ROUTES.activityLaunch(gameId)}`, {
      method: 'POST',
      headers: auth(a.token),
      body: JSON.stringify({ groupId: group.id }),
    })
    const { instance } = (await launched.json()) as { instance: { id: number } }
    const { code } = (await (
      await fetch(`${BASE}${API_ROUTES.activityInstanceJoin(instance.id)}`, {
        method: 'POST',
        headers: auth(b.token),
      })
    ).json()) as { code: string }
    const { token } = (await (
      await fetch(`${BASE}${API_ROUTES.activityInstanceToken(instance.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
    ).json()) as { token: string }

    const me = await fetch(`${BASE}${API_ROUTES.activitiesMe}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.status).toBe(200)
    const body = (await me.json()) as { instanceId: number; user: Record<string, unknown> }
    expect(body.instanceId).toBe(instance.id)
    expect(body.user.id).toBe(b.user.id)
    expect('email' in body.user).toBe(false)
    expect('birthDate' in body.user).toBe(false)

    // A full-power session token proves nothing to the game API.
    const sessionSneak = await fetch(`${BASE}${API_ROUTES.activitiesMe}`, {
      headers: { authorization: `Bearer ${b.token}` },
    })
    expect(sessionSneak.status).toBe(401)

    const anon = await fetch(`${BASE}${API_ROUTES.activitiesMe}`)
    expect(anon.status).toBe(401)
  })

  it('state relay reaches participants only', async () => {
    const [a, b, watcher] = [users[0]!, users[1]!, users[2]!]
    const group = await makeGroup(a.token, [b.user.id, watcher.user.id])
    const gameId = await catalogId(a.token)

    const launched = await fetch(`${BASE}${API_ROUTES.activityLaunch(gameId)}`, {
      method: 'POST',
      headers: auth(a.token),
      body: JSON.stringify({ groupId: group.id }),
    })
    const { instance } = (await launched.json()) as { instance: { id: number } }
    // Only B takes the second seat; the watcher stays a group member.
    await fetch(`${BASE}${API_ROUTES.activityInstanceJoin(instance.id)}`, {
      method: 'POST',
      headers: auth(b.token),
    })

    const open = (token: string) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
          headers: { authorization: `Bearer ${token}` },
        })
        const timer = setTimeout(() => reject(new Error('socket open timeout')), 5000)
        ws.once('open', () => {
          clearTimeout(timer)
          resolve(ws)
        })
        ws.once('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
      })
    const wsA = await open(a.token)
    const wsB = await open(b.token)
    const wsC = await open(watcher.token)
    try {
      const relayed = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('relay timeout')), 5000)
        wsB.once('message', (data) => {
          clearTimeout(timer)
          resolve(JSON.parse(String(data)) as Record<string, unknown>)
        })
      })
      const leaked: unknown[] = []
      wsC.on('message', (data) => leaked.push(JSON.parse(String(data))))

      wsA.send(JSON.stringify({ type: 'activity:state', instanceId: instance.id, state: { move: 4 } }))
      const msg = await relayed
      expect(msg.type).toBe('activity:state')
      expect(msg.instanceId).toBe(instance.id)
      expect(msg.userId).toBe(a.user.id)
      expect(msg.state).toEqual({ move: 4 })

      await sleep(300)
      expect(leaked).toEqual([])
    } finally {
      wsA.close()
      wsB.close()
      wsC.close()
    }
  })

  it('leaving revokes the token; the last seat ends the game', async () => {
    const [a, b] = [users[2]!, users[3]!]
    const group = await makeGroup(a.token, [b.user.id])
    const gameId = await catalogId(a.token)

    const launched = await fetch(`${BASE}${API_ROUTES.activityLaunch(gameId)}`, {
      method: 'POST',
      headers: auth(a.token),
      body: JSON.stringify({ groupId: group.id }),
    })
    const { instance } = (await launched.json()) as { instance: { id: number } }
    const { code } = (await (
      await fetch(`${BASE}${API_ROUTES.activityInstanceJoin(instance.id)}`, {
        method: 'POST',
        headers: auth(b.token),
      })
    ).json()) as { code: string }
    const { token } = (await (
      await fetch(`${BASE}${API_ROUTES.activityInstanceToken(instance.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
    ).json()) as { token: string }

    const left = await fetch(`${BASE}${API_ROUTES.activityInstanceLeave(instance.id)}`, {
      method: 'POST',
      headers: auth(b.token),
    })
    expect(left.status).toBe(200)
    expect(((await left.json()) as { ended: boolean }).ended).toBe(false)

    const stale = await fetch(`${BASE}${API_ROUTES.activitiesMe}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(stale.status).toBe(401)

    const last = await fetch(`${BASE}${API_ROUTES.activityInstanceLeave(instance.id)}`, {
      method: 'POST',
      headers: auth(a.token),
    })
    expect(((await last.json()) as { ended: boolean }).ended).toBe(true)

    const listed = await fetch(`${BASE}${API_ROUTES.activityInstances(group.id)}`, {
      headers: auth(a.token),
    })
    const { instances } = (await listed.json()) as { instances: Array<{ id: number }> }
    expect(instances.some((i) => i.id === instance.id)).toBe(false)
  })

  it('only game pages may be framed', async () => {
    // Status is irrelevant here (dist may not exist in this run); the
    // middleware wraps every response, including the SPA fallback.
    const game = await fetch(`${BASE}/activities/tictactoe`)
    expect(game.headers.get('x-frame-options')).toBe('SAMEORIGIN')

    const home = await fetch(`${BASE}/`)
    expect(home.headers.get('x-frame-options')).toBe('DENY')

    const api = await fetch(`${BASE}${API_ROUTES.activitiesMe}`)
    expect(api.headers.get('x-frame-options')).toBe('DENY')
  })
})

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawnServer, waitHealthy, stopServer, testDbUrl } from './helpers/server'
import { type ChildProcess, execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { API_ROUTES } from '../shared/constants'

const PORT = 8807
const BASE = `http://127.0.0.1:${PORT}`
const WS_URL = `ws://127.0.0.1:${PORT}/ws`

type SuiteUser = { token: string; user: { id: number } }

async function createUser(email: string, password: string): Promise<SuiteUser> {
  const reg = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, birthDate: '1990-01-15' }),
  })
  if (reg.status === 429) {
    await sleep(1000)
    return createUser(email, password)
  }
  expect(reg.status).toBe(201)
  return (await reg.json()) as SuiteUser
}

interface WsClient {
  messages: Array<{ type: string; [k: string]: unknown }>
  send(msg: unknown): void
  waitFor(type: string, timeout?: number): Promise<any>
  close(): void
}

function connectWs(token: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    const messages: Array<{ type: string; [k: string]: unknown }> = []
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 10_000)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ws:auth', token }))
    }
    ws.onmessage = (ev) => {
      messages.push(JSON.parse(String(ev.data)))
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('ws error'))
    }

    const client: WsClient = {
      messages,
      send(msg: unknown) {
        ws.send(JSON.stringify(msg))
      },
      waitFor(type: string, timeout = 10_000) {
        return new Promise((res, rej) => {
          const existing = messages.find((m) => m.type === type)
          if (existing) {
            res(existing)
            return
          }
          const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), timeout)
          const handler = (ev: MessageEvent) => {
            const msg = JSON.parse(String(ev.data))
            if (msg.type === type) {
              clearTimeout(t)
              ws.removeEventListener('message', handler)
              res(msg)
            }
          }
          ws.addEventListener('message', handler)
        })
      },
      close() {
        ws.close()
      },
    }

    // Wait for auth to register the socket
    setTimeout(() => {
      clearTimeout(timer)
      resolve(client)
    }, 500)
  })
}

describe('activity:invite relay', () => {
  let child: ChildProcess
  let users: SuiteUser[] = []
  let clientA: WsClient
  let clientB: WsClient
  let clientC: WsClient
  let roomId = ''
  let instanceId = 0

  const auth = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` })

  beforeAll(async () => {
    const databaseUrl = testDbUrl('activity-invite')
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
    for (const tag of ['a', 'b', 'c']) {
      users.push(await createUser(`ainv_${tag}_${stamp}@example.com`, 'password12'))
    }
    const [a, b, c] = users as [SuiteUser, SuiteUser, SuiteUser]

    // A room for A+B via the friend-invitation flow.
    await fetch(`${BASE}/api/friends/request`, {
      method: 'POST',
      headers: auth(a.token),
      body: JSON.stringify({ userId: b.user.id }),
    })
    await fetch(`${BASE}/api/friends/accept/${b.user.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${b.token}` },
    })
    clientA = await connectWs(a.token)
    clientB = await connectWs(b.token)
    clientC = await connectWs(c.token)
    clientA.send({ type: 'invitation:send', userId: b.user.id, roomId: '' })
    const invitation = await clientB.waitFor('invitation:send', 5000)
    clientB.send({ type: 'invitation:accept', invitationId: invitation.invitationId })
    const match = await clientA.waitFor('room:matched', 5000)
    roomId = match.roomId as string
    expect(roomId).toBeTruthy()

    // Party group + launched game, as the call client composes it.
    const groupRes = await fetch(`${BASE}${API_ROUTES.groups}`, {
      method: 'POST',
      headers: auth(a.token),
      body: JSON.stringify({ name: 'Party', memberIds: [b.user.id] }),
    })
    expect(groupRes.status).toBe(201)
    const { group } = (await groupRes.json()) as { group: { id: number } }
    const catalog = (await (
      await fetch(`${BASE}${API_ROUTES.activities}`, { headers: auth(a.token) })
    ).json()) as { activities: Array<{ id: number }> }
    const launched = await fetch(`${BASE}${API_ROUTES.activityLaunch(catalog.activities[0]!.id)}`, {
      method: 'POST',
      headers: auth(a.token),
      body: JSON.stringify({ groupId: group.id }),
    })
    expect(launched.status).toBe(201)
    instanceId = ((await launched.json()) as { instance: { id: number } }).instance.id
  })

  afterAll(async () => {
    clientA?.close()
    clientB?.close()
    clientC?.close()
    await stopServer(child)
  })

  it('relays the invite to the other call participant', async () => {
    const [a, b] = users as [SuiteUser, SuiteUser]
    clientA.send({ type: 'activity:invite', roomId, instanceId })
    const invited = await clientB.waitFor('activity:invited', 5000)
    expect(invited.roomId).toBe(roomId)
    expect(invited.instance.id).toBe(instanceId)
    expect(invited.activity.slug).toBe('tictactoe')
    expect(invited.inviter.id).toBe(a.user.id)
    // The sender gets no echo.
    await sleep(300)
    expect(clientA.messages.some((m) => m.type === 'activity:invited')).toBe(false)
    expect(b.user.id).toBeTruthy()
  })

  it('rejects invites from sockets outside the call', async () => {
    clientC.send({ type: 'activity:invite', roomId, instanceId })
    const err = await clientC.waitFor('error', 5000)
    expect(err.code).toBe('bad_prefs')
    expect(err.message).toBe('You are not in that call.')
  })

  it('rejects invites from call participants without a seat', async () => {
    clientB.send({ type: 'activity:invite', roomId, instanceId })
    const err = await clientB.waitFor('error', 5000)
    expect(err.code).toBe('bad_prefs')
    expect(err.message).toBe('Join the game before inviting.')
  })

  it('a joined peer can invite back', async () => {
    const [a, b] = users as [SuiteUser, SuiteUser]
    const join = await fetch(`${BASE}${API_ROUTES.activityInstanceJoin(instanceId)}`, {
      method: 'POST',
      headers: auth(b.token),
    })
    expect(join.status).toBe(200)
    expect(((await join.json()) as { code: string }).code).toBeTruthy()
    clientB.send({ type: 'activity:invite', roomId, instanceId })
    const invited = await clientA.waitFor('activity:invited', 5000)
    expect(invited.instance.id).toBe(instanceId)
    expect(invited.inviter.id).toBe(b.user.id)
    expect(a.user.id).toBeTruthy()
  })
})

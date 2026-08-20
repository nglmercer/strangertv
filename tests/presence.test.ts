import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawnServer, waitHealthy, stopServer } from './helpers/server'
import { type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8801
const BASE = `http://127.0.0.1:${PORT}`
const WS_URL = `ws://127.0.0.1:${PORT}/ws`


async function createUser(email: string) {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password12', birthDate: '1990-01-15' }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { token: string; user: { id: number } }
}

type Frame = { type: string; [k: string]: unknown }

function connect(token: string) {
  return new Promise<{ ws: WebSocket; frames: Frame[]; waitFor: (type: string, ms?: number) => Promise<Frame> }>((resolve) => {
    const ws = new WebSocket(WS_URL)
    const frames: Frame[] = []
    ws.onmessage = (ev) => frames.push(JSON.parse(String(ev.data)) as Frame)
    ws.onopen = () => ws.send(JSON.stringify({ type: 'ws:auth', token }))
    const waitFor = (type: string, ms = 5000) =>
      new Promise<Frame>((res, rej) => {
        const existing = frames.find((f) => f.type === type)
        if (existing) return res(existing)
        const timer = setTimeout(() => rej(new Error(`timeout waiting for ${type}: ${frames.map((f) => f.type).join(',')}`)), ms)
        const handler = (ev: MessageEvent) => {
          const frame = JSON.parse(String(ev.data)) as Frame
          if (frame.type === type) {
            clearTimeout(timer)
            ws.removeEventListener('message', handler)
            res(frame)
          }
        }
        ws.addEventListener('message', handler)
      })
    setTimeout(() => resolve({ ws, frames, waitFor }), 400)
  })
}

describe('friend presence', () => {
  let child: ChildProcess

  beforeAll(async () => {
    child = spawnServer({
      PORT: String(PORT),
      ADMIN_KEY: 'itest-admin',
      NODE_ENV: 'test',
      REGISTER_RATE_LIMIT: '1000',
      TURSO_DATABASE_URL: `file:presence_${Date.now()}.db`,
    })
    await waitHealthy(BASE)
  })

  afterAll(async () => {
    await stopServer(child)
  })

  it('tells friends who is online, and when they connect or drop', async () => {
    const stamp = Date.now()
    const a = await createUser(`pres_a_${stamp}@example.com`)
    const b = await createUser(`pres_b_${stamp}@example.com`)
    const auth = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` })

    await fetch(`${BASE}/api/v1/friends/request`, {
      method: 'POST',
      headers: auth(a.token),
      body: JSON.stringify({ userId: b.user.id }),
    })
    const friends = (await (await fetch(`${BASE}/api/v1/friends`, { headers: auth(b.token) })).json()) as {
      friends: Array<{ id: number }>
    }
    await fetch(`${BASE}/api/v1/friends/${friends.friends[0]!.id}/accept`, { method: 'PATCH', headers: auth(b.token) })

    // A connects first: nobody else is online yet.
    const clientA = await connect(a.token)
    const listA = await clientA.waitFor('presence:list')
    expect(listA.userIds).toEqual([])

    // B connects: B is told A is online, and A is told about B.
    const clientB = await connect(b.token)
    const listB = await clientB.waitFor('presence:list')
    expect(listB.userIds).toEqual([a.user.id])
    const online = await clientA.waitFor('presence:online')
    expect(online.userId).toBe(b.user.id)

    // B drops: A hears about it.
    clientB.ws.close()
    const offline = await clientA.waitFor('presence:offline')
    expect(offline.userId).toBe(b.user.id)

    clientA.ws.close()
  })
})

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawnServer, waitHealthy, stopServer } from './helpers/server'
import { type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8798
const BASE = `http://127.0.0.1:${PORT}`
const WS_URL = `ws://127.0.0.1:${PORT}/ws`


async function createUser(email: string, password: string) {
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, birthDate: '1990-01-15' }),
  })
  if (reg.status === 429) {
    await sleep(1000)
    return createUser(email, password)
  }
  expect(reg.status).toBe(201)
  const body = (await reg.json()) as { token: string; user: { id: number } }
  return body
}

interface WsClient {
  ws: WebSocket
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
      const msg = JSON.parse(String(ev.data))
      messages.push(msg)
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('ws error'))
    }

    const client: WsClient = {
      ws,
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

describe('invitation flow', () => {
  let child: ChildProcess

  beforeAll(async () => {
    child = spawnServer({
      PORT: String(PORT),
      ADMIN_KEY: 'itest-admin',
      NODE_ENV: 'test',
      TURSO_DATABASE_URL: `file:invitation_${Date.now()}.db`,
    })
    await waitHealthy(BASE)
  })

  afterAll(async () => {
    await stopServer(child)
  })

  it('full invitation flow: send → receive → accept → matched', async () => {
    const password = 'password12'
    const userA = await createUser(`inv_a_${Date.now()}@example.com`, password)
    const userB = await createUser(`inv_b_${Date.now()}@example.com`, password)

    // Make them friends first
    await fetch(`${BASE}/api/friends/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${userA.token}` },
      body: JSON.stringify({ userId: userB.user.id }),
    })
    await fetch(`${BASE}/api/friends/accept/${userB.user.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${userB.token}` },
    })

    const clientA = await connectWs(userA.token)
    const clientB = await connectWs(userB.token)

    // User A sends invitation to User B
    clientA.send({ type: 'invitation:send', userId: userB.user.id, roomId: '' })

    // User B should receive the invitation
    const invitation = await clientB.waitFor('invitation:send', 5000)
    expect(invitation.invitationId).toBeTruthy()
    expect(invitation.inviter.id).toBe(userA.user.id)

    // User B accepts the invitation
    clientB.send({ type: 'invitation:accept', invitationId: invitation.invitationId })

    // User A should be notified that invitation was accepted
    const accepted = await clientA.waitFor('invitation:accepted', 5000)
    expect(accepted.invitationId).toBe(invitation.invitationId)

    // Both should be matched in a new room
    const matchA = await clientA.waitFor('room:matched', 5000)
    const matchB = await clientB.waitFor('room:matched', 5000)
    expect(matchA.roomId).toBeTruthy()
    expect(matchA.roomId).toBe(matchB.roomId)

    clientA.close()
    clientB.close()
  })

  it('sender socket is registered (from is not undefined)', async () => {
    const userA = await createUser(`reg_a_${Date.now()}@example.com`, 'password12')
    const userB = await createUser(`reg_b_${Date.now()}@example.com`, 'password12')

    const clientA = await connectWs(userA.token)
    const clientB = await connectWs(userB.token)

    // User A sends invitation — server should recognize the sender
    clientA.send({ type: 'invitation:send', userId: userB.user.id, roomId: '' })

    // If sender socket is NOT registered, the server logs "from: undefined"
    // and the invitation is NOT delivered. We verify it IS delivered.
    const invitation = await clientB.waitFor('invitation:send', 5000)
    expect(invitation.invitationId).toBeTruthy()

    clientA.close()
    clientB.close()
  })

  it('accepting same invitation twice does not crash', async () => {
    const userA = await createUser(`idem_a_${Date.now()}@example.com`, 'password12')
    const userB = await createUser(`idem_b_${Date.now()}@example.com`, 'password12')

    const clientA = await connectWs(userA.token)
    const clientB = await connectWs(userB.token)

    clientA.send({ type: 'invitation:send', userId: userB.user.id, roomId: '' })
    const invitation = await clientB.waitFor('invitation:send', 5000)

    // First accept
    clientB.send({ type: 'invitation:accept', invitationId: invitation.invitationId })
    await clientA.waitFor('invitation:accepted', 5000)

    // Second accept (idempotent — should not crash)
    clientB.send({ type: 'invitation:accept', invitationId: invitation.invitationId })

    // Give server time to process
    await sleep(500)

    // Server should still be alive — verify by sending another message
    clientA.send({ type: 'invitation:send', userId: userB.user.id, roomId: '' })
    const invitation2 = await clientB.waitFor('invitation:send', 5000)
    expect(invitation2.invitationId).toBeTruthy()

    clientA.close()
    clientB.close()
  })

  it('declining invitation notifies sender', async () => {
    const userA = await createUser(`dec_a_${Date.now()}@example.com`, 'password12')
    const userB = await createUser(`dec_b_${Date.now()}@example.com`, 'password12')

    const clientA = await connectWs(userA.token)
    const clientB = await connectWs(userB.token)

    clientA.send({ type: 'invitation:send', userId: userB.user.id, roomId: '' })
    const invitation = await clientB.waitFor('invitation:send', 5000)

    // User B declines
    clientB.send({ type: 'invitation:decline', invitationId: invitation.invitationId })

    // User A should be notified
    const declined = await clientA.waitFor('invitation:declined', 5000)
    expect(declined.invitationId).toBe(invitation.invitationId)

    clientA.close()
    clientB.close()
  })

  it('re-authenticating after WS open allows sending invitations', async () => {
    // Simulates: WS connection opens BEFORE user logs in, then user logs in
    const userA = await createUser(`reauth_a_${Date.now()}@example.com`, 'password12')
    const userB = await createUser(`reauth_b_${Date.now()}@example.com`, 'password12')

    // Create WS connection WITHOUT sending auth (simulates pre-login state)
    const clientA = await new Promise<WsClient>((resolve, reject) => {
      const ws = new WebSocket(WS_URL)
      const messages: Array<{ type: string; [k: string]: unknown }> = []
      const timer = setTimeout(() => reject(new Error('timeout')), 10_000)
      ws.onmessage = (ev) => messages.push(JSON.parse(String(ev.data)))
      ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')) }
      const client: WsClient = {
        ws, messages,
        send(msg: unknown) { ws.send(JSON.stringify(msg)) },
        waitFor(type: string, timeout = 10_000) {
          return new Promise((res, rej) => {
            const existing = messages.find((m) => m.type === type)
            if (existing) { res(existing); return }
            const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), timeout)
            const handler = (ev: MessageEvent) => {
              const msg = JSON.parse(String(ev.data))
              if (msg.type === type) { clearTimeout(t); ws.removeEventListener('message', handler); res(msg) }
            }
            ws.addEventListener('message', handler)
          })
        },
        close() { ws.close() },
      }
      setTimeout(() => { clearTimeout(timer); resolve(client) }, 200)
    })

    const clientB = await connectWs(userB.token)

    // NOW send auth (simulates user logging in after WS is already open)
    clientA.send({ type: 'ws:auth', token: userA.token })

    // Wait for auth to be processed
    await sleep(300)

    // Send invitation — should work because re-auth happened
    clientA.send({ type: 'invitation:send', userId: userB.user.id, roomId: '' })
    const invitation = await clientB.waitFor('invitation:send', 5000)
    expect(invitation.invitationId).toBeTruthy()
    expect(invitation.inviter.id).toBe(userA.user.id)

    clientA.close()
    clientB.close()
  })


})

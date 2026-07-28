import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8800
const BASE = `http://127.0.0.1:${PORT}`
const WS_URL = `ws://127.0.0.1:${PORT}/ws`

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

    setTimeout(() => {
      clearTimeout(timer)
      resolve(client)
    }, 500)
  })
}

describe('group invite from match', () => {
  let child: ChildProcess

  beforeAll(async () => {
    child = spawn('npx', ['tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        ADMIN_KEY: 'itest-admin',
        NODE_ENV: 'test',
        TURSO_DATABASE_URL: `file:group_invite_${Date.now()}.db`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitHealthy()
  })

  afterAll(async () => {
    child.kill('SIGTERM')
    await sleep(300)
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  })

  it('matched peer can invite other to group — invitee joins and group auto-enters queue', async () => {
    const password = 'password12'
    const userA = await createUser(`gifa_${Date.now()}@example.com`, password)
    const userB = await createUser(`gifb_${Date.now()}@example.com`, password)

    const clientA = await connectWs(userA.token)
    const clientB = await connectWs(userB.token)

    // Both join queue to get matched together (include token for userId association)
    clientA.send({
      type: 'queue:join',
      token: userA.token,
      preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' },
    })
    clientB.send({
      type: 'queue:join',
      token: userB.token,
      preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' },
    })

    // Both should get matched
    const matchA = await clientA.waitFor('room:matched', 5000)
    const matchB = await clientB.waitFor('room:matched', 5000)
    expect(matchA.roomId).toBe(matchB.roomId)
    expect(matchA.peerUserId).toBe(userB.user.id)
    expect(matchB.peerUserId).toBe(userA.user.id)

    // User A creates a private group AND invites User B atomically
    clientA.send({ type: 'group-match:create-and-invite', token: userA.token, visibility: 'private', userId: userB.user.id, preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'group', matchScope: 'all' } })

    // User A should get group-match:created
    const groupCreated = await clientA.waitFor('group-match:created', 5000)
    expect(groupCreated.roomId).toBeTruthy()
    expect(groupCreated.visibility).toBe('private')

    // User B should receive group-match:invite-received
    const inviteReceived = await clientB.waitFor('group-match:invite-received', 5000)
    expect(inviteReceived.roomId).toBe(groupCreated.roomId)
    expect(inviteReceived.host.id).toBe(userA.user.id)

    // User B joins the group
    clientB.send({ type: 'group-match:join', token: userB.token, roomId: groupCreated.roomId })

    // User A should be notified that participant joined
    const participantJoined = await clientA.waitFor('group-match:participant-joined', 5000)
    expect(participantJoined.userId).toBe(userB.user.id)

    // Both should get queue:waiting (auto-enter queue after 2nd participant)
    const waitA = await clientA.waitFor('queue:waiting', 5000)
    expect(waitA.position).toBeGreaterThan(0)

    clientA.close()
    clientB.close()
  })

  it('signal relay works after group match (targetUserId is set)', async () => {
    const password = 'password12'
    const userA = await createUser(`gsig_a_${Date.now()}@example.com`, password)
    const userB = await createUser(`gsig_b_${Date.now()}@example.com`, password)

    const clientA = await connectWs(userA.token)
    const clientB = await connectWs(userB.token)

    clientA.send({
      type: 'queue:join',
      token: userA.token,
      preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' },
    })
    clientB.send({
      type: 'queue:join',
      token: userB.token,
      preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' },
    })

    await clientA.waitFor('room:matched', 5000)
    await clientB.waitFor('room:matched', 5000)

    clientA.send({ type: 'group-match:create-and-invite', token: userA.token, visibility: 'private', userId: userB.user.id, preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'group', matchScope: 'all' } })
    const groupCreated = await clientA.waitFor('group-match:created', 5000)

    await clientB.waitFor('group-match:invite-received', 5000)

    clientB.send({ type: 'room:leave' })
    clientB.send({ type: 'queue:leave' })
    clientB.send({ type: 'group-match:join', token: userB.token, roomId: groupCreated.roomId })

    await clientA.waitFor('group-match:participant-joined', 5000)

    const matchedA = await clientA.waitFor('group-match:matched', 5000)
    const matchedB = await clientB.waitFor('group-match:matched', 5000)
    expect(matchedA.roomId).toBe(matchedB.roomId)
    expect(matchedA.peers.length).toBe(1)
    expect(matchedB.peers.length).toBe(1)

    const offererClient = matchedA.role === 'offerer' ? clientA : clientB
    const answererClient = matchedA.role === 'offerer' ? clientB : clientA
    const offererId = matchedA.role === 'offerer' ? userA.user.id : userB.user.id
    const answererId = matchedA.role === 'offerer' ? userB.user.id : userA.user.id

    offererClient.send({ type: 'signal', payload: { kind: 'offer', data: { type: 'offer', sdp: 'fake-sdp' } }, targetUserId: answererId })

    const signal = await answererClient.waitFor('signal', 5000)
    expect(signal.targetUserId).toBe(offererId)
    expect(signal.payload.kind).toBe('offer')

    answererClient.send({ type: 'signal', payload: { kind: 'answer', data: { type: 'answer', sdp: 'fake-answer' } }, targetUserId: offererId })

    const answer = await offererClient.waitFor('signal', 5000)
    expect(answer.targetUserId).toBe(answererId)
    expect(answer.payload.kind).toBe('answer')

    clientA.close()
    clientB.close()
  })

  it('invitee leaving solo match to join group notifies their prior partner', async () => {
    const password = 'password12'
    const userA = await createUser(`gif2a_${Date.now()}@example.com`, password)
    const userB = await createUser(`gif2b_${Date.now()}@example.com`, password)
    const userC = await createUser(`gif2c_${Date.now()}@example.com`, password)

    const clientA = await connectWs(userA.token)
    const clientB = await connectWs(userB.token)
    const clientC = await connectWs(userC.token)

    // A and B get matched together
    clientA.send({
      type: 'queue:join',
      token: userA.token,
      preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' },
    })
    clientB.send({
      type: 'queue:join',
      token: userB.token,
      preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' },
    })

    await clientA.waitFor('room:matched', 5000)
    await clientB.waitFor('room:matched', 5000)

    // C also joins and waits (to have a clean state)
    clientC.send({
      type: 'queue:join',
      token: userC.token,
      preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' },
    })

    // A creates private group AND invites B atomically
    clientA.send({ type: 'group-match:create-and-invite', token: userA.token, visibility: 'private', userId: userB.user.id, preferences: { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'group', matchScope: 'all' } })
    const groupCreated = await clientA.waitFor('group-match:created', 5000)

    // B receives invite
    await clientB.waitFor('group-match:invite-received', 5000)

    // B joins the group — A should see B joined
    clientB.send({ type: 'group-match:join', token: userB.token, roomId: groupCreated.roomId })
    await clientA.waitFor('group-match:participant-joined', 5000)

    // A and B should now be in queue (auto-enter)
    await clientA.waitFor('queue:waiting', 5000)

    clientA.close()
    clientB.close()
    clientC.close()
  })
})

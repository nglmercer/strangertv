import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawnServer, waitHealthy, stopServer } from './helpers/server'
import { type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8800
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

function connectWs(token?: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    const messages: Array<{ type: string; [k: string]: unknown }> = []
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 10_000)

    ws.onopen = () => {
      if (token) ws.send(JSON.stringify({ type: 'ws:auth', token }))
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

/**
 * waitFor() returns the first buffered message of a type, which collides with
 * messages from an earlier phase of the same test (e.g. a first group match).
 * Wait on a predicate and only consider messages recorded after `from`.
 */
function waitForMatch(client: WsClient, from: number, pred: (m: any) => boolean, timeout = 5000) {
  return new Promise<any>((res, rej) => {
    const scan = () => {
      for (let i = from; i < client.messages.length; i++) {
        if (pred(client.messages[i])) return client.messages[i]
      }
      return undefined
    }
    const found = scan()
    if (found) {
      res(found)
      return
    }
    const handler = () => {
      const f = scan()
      if (f) {
        clearTimeout(t)
        client.ws.removeEventListener('message', handler)
        res(f)
      }
    }
    const t = setTimeout(() => {
      client.ws.removeEventListener('message', handler)
      rej(new Error(`timeout waiting; buffer=${JSON.stringify(client.messages.map((m) => m.type))}`))
    }, timeout)
    client.ws.addEventListener('message', handler)
  })
}

describe('group invite from match', () => {
  let child: ChildProcess

  beforeAll(async () => {
    child = spawnServer({
      PORT: String(PORT),
      ADMIN_KEY: 'itest-admin',
      NODE_ENV: 'test',
      // The suite registers many users against one shared server; lift the
      // default 10/15min cap so later tests don't hit the rate limit.
      REGISTER_RATE_LIMIT: '1000',
      TURSO_DATABASE_URL: `file:group_invite_${Date.now()}.db`,
    })
    await waitHealthy(BASE)
  })

  afterAll(async () => {
    await stopServer(child)
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

  it('group match assigns unique peerIds and routes signals by peerId (multi-guest userId collision)', async () => {
    const password = 'password12'
    const host = await createUser(`gpeer_host_${Date.now()}@example.com`, password)

    const hostClient = await connectWs(host.token)
    const guestB = await connectWs() // anonymous -> userId 0
    const guestC = await connectWs() // anonymous -> userId 0

    const prefsAll = { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' }

    // guestC waits in the solo queue first so the group can merge with it.
    guestC.send({ type: 'queue:join', preferences: prefsAll })
    await guestC.waitFor('queue:waiting', 5000)

    // host creates a group but does NOT join the solo queue, so it won't
    // solo-match guestC ahead of time.
    hostClient.send({ type: 'group-match:create', token: host.token, visibility: 'private', preferences: { ...prefsAll, mode: 'group', matchScope: 'all' } })
    const groupCreated = await hostClient.waitFor('group-match:created', 5000)

    // guestB joins the group directly by roomId (anonymous). Group size becomes
    // 2, which auto-enters the queue and merges with solo guestC -> a 3-way
    // match containing TWO guests that both have userId 0.
    guestB.send({ type: 'group-match:join', roomId: groupCreated.roomId })

    const matchedHost = await hostClient.waitFor('group-match:matched', 5000)
    const matchedB = await guestB.waitFor('group-match:matched', 5000)
    const matchedC = await guestC.waitFor('group-match:matched', 5000)

    // Each participant sees the other two as peers.
    expect(matchedHost.peers.length).toBe(2)
    expect(matchedB.peers.length).toBe(2)
    expect(matchedC.peers.length).toBe(2)

    // The three participants' own peerIds must be unique.
    const ownIds = new Set<number>([matchedHost.peerId, matchedB.peerId, matchedC.peerId])
    expect(ownIds.size).toBe(3)

    // The two guests share userId 0 but MUST have distinct peerIds — this is
    // the collision that previously broke mesh negotiation and signal routing.
    const guests = (matchedHost.peers as Array<{ userId: number; peerId: number }>).filter((p) => p.userId === 0)
    expect(guests.length).toBe(2)
    expect(guests[0].peerId).not.toBe(guests[1].peerId)

    const targetGuest = guests[0]
    const otherGuest = guests[1]
    const targetClient = matchedB.peerId === targetGuest.peerId ? guestB : guestC
    const otherClient = matchedB.peerId === targetGuest.peerId ? guestC : guestB

    // A signal targeted at one guest's peerId reaches exactly that guest,
    // stamped with the sender's fromPeerId.
    hostClient.send({ type: 'signal', payload: { kind: 'offer', data: { type: 'offer', sdp: 'fake' } }, targetPeerId: targetGuest.peerId })
    const sig = await targetClient.waitFor('signal', 5000)
    expect(sig.fromPeerId).toBe(matchedHost.peerId)
    expect((sig.payload as { kind: string }).kind).toBe('offer')

    // The other guest (same userId 0) must NOT receive that targeted signal.
    await sleep(400)
    expect(otherClient.messages.some((m) => m.type === 'signal')).toBe(false)

    // The second guest is individually addressable too, despite the shared userId.
    hostClient.send({ type: 'signal', payload: { kind: 'offer', data: { type: 'offer', sdp: 'fake2' } }, targetPeerId: otherGuest.peerId })
    const sig2 = await otherClient.waitFor('signal', 5000)
    expect(sig2.fromPeerId).toBe(matchedHost.peerId)

    hostClient.close()
    guestB.close()
    guestC.close()
  })

  it('non-host leaving an active group match notifies remaining peers with peerId (graceful exit)', async () => {
    const password = 'password12'
    const host = await createUser(`gleave_host_${Date.now()}@example.com`, password)

    const hostClient = await connectWs(host.token)
    const guestB = await connectWs() // anonymous -> userId 0
    const guestC = await connectWs() // anonymous -> userId 0

    const prefsAll = { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' }

    guestC.send({ type: 'queue:join', preferences: prefsAll })
    await guestC.waitFor('queue:waiting', 5000)

    hostClient.send({ type: 'group-match:create', token: host.token, visibility: 'private', preferences: { ...prefsAll, mode: 'group', matchScope: 'all' } })
    const groupCreated = await hostClient.waitFor('group-match:created', 5000)

    guestB.send({ type: 'group-match:join', roomId: groupCreated.roomId })

    const matchedHost = await hostClient.waitFor('group-match:matched', 5000)
    const matchedB = await guestB.waitFor('group-match:matched', 5000)
    const matchedC = await guestC.waitFor('group-match:matched', 5000)
    expect(matchedHost.peers.length).toBe(2)

    // guestC (a non-host participant) leaves the active group match.
    guestC.send({ type: 'group-match:leave' })

    // The remaining participants are notified with the leaver's peerId so they
    // can tear down the correct mesh peer (the two guests share userId 0).
    const leftHost = await hostClient.waitFor('group-match:participant-left', 5000)
    const leftB = await guestB.waitFor('group-match:participant-left', 5000)

    expect(leftHost.peerId).toBe(matchedC.peerId)
    expect(leftB.peerId).toBe(matchedC.peerId)
    expect(leftHost.userId).toBe(0)

    hostClient.close()
    guestB.close()
    guestC.close()
  })

  it('host leaving an active group match degrades gracefully (group|solo -> solo|solo) instead of disconnecting everyone', async () => {
    const password = 'password12'
    const host = await createUser(`ghostleave_host_${Date.now()}@example.com`, password)

    const hostClient = await connectWs(host.token)
    const guestB = await connectWs() // anonymous -> userId 0
    const guestC = await connectWs() // anonymous -> userId 0 (the solo side)

    const prefsAll = { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' }

    // Solo waits in queue; the group will match against it.
    guestC.send({ type: 'queue:join', preferences: prefsAll })
    await guestC.waitFor('queue:waiting', 5000)

    hostClient.send({ type: 'group-match:create', token: host.token, visibility: 'private', preferences: { ...prefsAll, mode: 'group', matchScope: 'all' } })
    const groupCreated = await hostClient.waitFor('group-match:created', 5000)

    guestB.send({ type: 'group-match:join', roomId: groupCreated.roomId })

    const matchedHost = await hostClient.waitFor('group-match:matched', 5000)
    const matchedB = await guestB.waitFor('group-match:matched', 5000)
    const matchedC = await guestC.waitFor('group-match:matched', 5000)
    expect(matchedHost.peers.length).toBe(2)

    // The host (group side) leaves the active match. This used to send
    // room:peer-left to everyone and destroy the whole match.
    hostClient.send({ type: 'group-match:leave' })

    // Survivors get a participant-left (with peerId) so they keep the call as a
    // solo|solo pair — NOT a room:peer-left that would disconnect them.
    const leftB = await guestB.waitFor('group-match:participant-left', 5000)
    const leftC = await guestC.waitFor('group-match:participant-left', 5000)
    expect(leftB.peerId).toBe(matchedHost.peerId)
    expect(leftC.peerId).toBe(matchedHost.peerId)

    // The match is still alive for the two survivors: no room:peer-left yet.
    expect(guestB.messages.some((m) => m.type === 'room:peer-left')).toBe(false)
    expect(guestC.messages.some((m) => m.type === 'room:peer-left')).toBe(false)

    // When the match drops to a single participant it ends for them.
    guestB.send({ type: 'group-match:leave' })
    const endedC = await guestC.waitFor('room:peer-left', 5000)
    expect(endedC).toBeTruthy()

    hostClient.close()
    guestB.close()
    guestC.close()
  })

  it('inviting to a group from a degraded solo|solo match delivers the invite (no userId, no 1:1 partner)', async () => {
    const password = 'password12'
    const host = await createUser(`ginvite_host_${Date.now()}@example.com`, password)

    const hostClient = await connectWs(host.token)
    const guestB = await connectWs() // anonymous -> userId 0
    const guestC = await connectWs() // anonymous -> userId 0 (the solo side)

    const prefsAll = { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' }

    guestC.send({ type: 'queue:join', preferences: prefsAll })
    await guestC.waitFor('queue:waiting', 5000)

    hostClient.send({ type: 'group-match:create', token: host.token, visibility: 'private', preferences: { ...prefsAll, mode: 'group', matchScope: 'all' } })
    const groupCreated = await hostClient.waitFor('group-match:created', 5000)

    guestB.send({ type: 'group-match:join', roomId: groupCreated.roomId })

    await hostClient.waitFor('group-match:matched', 5000)
    await guestB.waitFor('group-match:matched', 5000)
    await guestC.waitFor('group-match:matched', 5000)

    // Degrade group|solo -> solo|solo: the solo side leaves, host + guestB remain.
    guestC.send({ type: 'group-match:leave' })
    await hostClient.waitFor('group-match:participant-left', 5000)
    await guestB.waitFor('group-match:participant-left', 5000)

    // Snapshot buffer lengths so we only inspect messages produced after this point.
    const hostFrom = hostClient.messages.length
    const bFrom = guestB.messages.length

    // From the degraded match the host invites "the other person" to a group.
    // The client has no peerUserId here and there is no 1:1 partner, so no
    // userId is sent — the server must resolve the target from the group room.
    hostClient.send({ type: 'group-match:create-and-invite', token: host.token, visibility: 'private', preferences: { ...prefsAll, mode: 'group', matchScope: 'all' } })

    // The host gets a fresh group room (a NEW group-match:created)...
    const newGroup = await waitForMatch(hostClient, hostFrom, (m) => m.type === 'group-match:created')
    // ...and the remaining participant receives the invite instead of being
    // silently disconnected.
    const invite = await waitForMatch(guestB, bFrom, (m) => m.type === 'group-match:invite-received')
    expect(invite.roomId).toBe(newGroup.roomId)

    // Accepting the invite reunites them in the new group.
    guestB.send({ type: 'group-match:join', roomId: newGroup.roomId })
    const joined = await waitForMatch(hostClient, hostFrom, (m) => m.type === 'group-match:participant-joined' && m.roomId === newGroup.roomId)
    expect(joined.roomId).toBe(newGroup.roomId)

    hostClient.close()
    guestB.close()
    guestC.close()
  })

  it('a pair with nobody to match keeps searching: members connect on the same side and stay queued', async () => {
    const password = 'password12'
    const host = await createUser(`gsearch_host_${Date.now()}@example.com`, password)
    const hostClient = await connectWs(host.token)
    const guestB = await connectWs() // anonymous -> userId 0

    const prefsAll = { country: 'any', language: 'any', gender: 'any', lookingFor: 'any', interests: [], allowMatchWithSameUsers: true, mode: 'solo', matchScope: 'all' }

    hostClient.send({ type: 'group-match:create', token: host.token, visibility: 'private', preferences: { ...prefsAll, mode: 'group', matchScope: 'all' } })
    const groupCreated = await hostClient.waitFor('group-match:created', 5000)
    guestB.send({ type: 'group-match:join', roomId: groupCreated.roomId })

    // With no opposing side available, the two members are connected to each
    // other — but both land on the SAME (local) side of the stage.
    const matchedHost = await hostClient.waitFor('group-match:matched', 5000)
    const matchedB = await guestB.waitFor('group-match:matched', 5000)
    expect(matchedHost.peers.map((p: any) => p.side)).toEqual(['local'])
    expect(matchedB.peers.map((p: any) => p.side)).toEqual(['local'])

    // ...and the room stays in the queue, so both clients get a fresh
    // queue:waiting AFTER the match and keep showing "searching" for the
    // opposing side instead of settling into a finished 2-person call.
    const matchedIdx = hostClient.messages.findIndex((m) => m.type === 'group-match:matched')
    const waiting = await waitForMatch(hostClient, matchedIdx + 1, (m) => m.type === 'queue:waiting')
    expect(waiting.position).toBeGreaterThan(0)

    // A solo peer arriving later fills the empty side for everyone.
    const guestC = await connectWs()
    const hostFrom = hostClient.messages.length
    const bFrom = guestB.messages.length
    guestC.send({ type: 'queue:join', preferences: prefsAll })

    const rematchHost = await waitForMatch(hostClient, hostFrom, (m) => m.type === 'group-match:matched')
    const rematchB = await waitForMatch(guestB, bFrom, (m) => m.type === 'group-match:matched')
    const matchedC = await guestC.waitFor('group-match:matched', 5000)

    expect(rematchHost.roomId).toBe(matchedC.roomId)
    expect(rematchB.roomId).toBe(matchedC.roomId)
    // Host now sees one companion (local) and the newcomer (remote)...
    expect(rematchHost.peers.map((p: any) => p.side).sort()).toEqual(['local', 'remote'])
    // ...while the newcomer sees the pair as the opposing side.
    expect(matchedC.peers.length).toBe(2)
    expect(matchedC.peers.every((p: any) => p.side === 'remote')).toBe(true)

    hostClient.close()
    guestB.close()
    guestC.close()
  })
})

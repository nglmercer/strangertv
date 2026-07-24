import type { Gender, MatchPreferences, Role, ServerMessage } from '../shared/types'
import {
  DEFAULT_COUNTRY,
  DEFAULT_GENDER,
  DEFAULT_LANGUAGE,
  GENDERS,
  METRIC_NAMES,
  PEER_LEFT_REASON,
  ROLE,
  SERVER_ERROR_CODE,
  WS_MESSAGE_TYPE,
} from '../shared/constants'
import { inc, observeMs } from './metrics'
import { getRelationship } from './messages'
import type { RelationshipStatus } from '../shared/types'

export type SocketLike = {
  send: (message: string) => void
  readyState: number
}

export type QueuePeer = {
  socket: SocketLike
  preferences: MatchPreferences
  userId?: number
  email?: string
  sessionKey: string
  joinedAt: number
  lastBeat: number
}

export type Room = {
  id: string
  a: SocketLike
  b: SocketLike
  aUserId?: number
  bUserId?: number
  createdAt: number
}

const waiting: QueuePeer[] = []
const partners = new Map<SocketLike, SocketLike>()
const roomsBySocket = new Map<SocketLike, Room>()
const peerMeta = new Map<SocketLike, QueuePeer>()
const blockedPairs = new Set<string>() // "minId:maxId"
/** Recent matches: key userA:userB or sessionA:sessionB → expiry ms */
const recentPairs = new Map<string, number>()
const RECENT_COOLDOWN_MS = Number(process.env.REMATCH_COOLDOWN_MS ?? 10 * 60_000)
/** userId → Set<SocketLike> for real-time notifications */
const userSockets = new Map<number, Set<SocketLike>>()

/** Canonical unordered key for a pair of identifiers (smaller first). */
function pairKey(prefix: string, a: string | number, b: string | number) {
  return a < b ? `${prefix}:${a}:${b}` : `${prefix}:${b}:${a}`
}

function pairKeyUsers(a: number, b: number) {
  return pairKey('u', a, b)
}

function pairKeySessions(a: string, b: string) {
  return pairKey('s', a, b)
}

export function blockPair(a: number, b: number) {
  blockedPairs.add(pairKey('', a, b))
}

export function unblockPair(a: number, b: number) {
  blockedPairs.delete(pairKey('', a, b))
}

export function isBlockedPair(a?: number, b?: number) {
  if (!a || !b) return false
  return blockedPairs.has(pairKey('', a, b))
}

function isRecentPair(a: QueuePeer, b: QueuePeer) {
  const now = Date.now()
  if (a.userId && b.userId) {
    const exp = recentPairs.get(pairKeyUsers(a.userId, b.userId))
    if (exp && exp > now) return true
  }
  const expS = recentPairs.get(pairKeySessions(a.sessionKey, b.sessionKey))
  return Boolean(expS && expS > now)
}

function rememberPair(a: QueuePeer, b: QueuePeer) {
  const until = Date.now() + RECENT_COOLDOWN_MS
  if (a.userId && b.userId) recentPairs.set(pairKeyUsers(a.userId, b.userId), until)
  recentPairs.set(pairKeySessions(a.sessionKey, b.sessionKey), until)
  // prune occasionally
  if (recentPairs.size > 5000) {
    for (const [k, exp] of recentPairs) {
      if (exp <= Date.now()) recentPairs.delete(k)
    }
  }
}

export function rematchCooldownMs() {
  return RECENT_COOLDOWN_MS
}

/** Hydrate in-memory block set from DB rows. */
export function hydrateBlocks(rows: Array<{ blocker_id: unknown; blocked_id: unknown }>) {
  for (const row of rows) {
    const a = Number(row.blocker_id)
    const b = Number(row.blocked_id)
    if (a && b) blockPair(a, b)
  }
}

export function getPartnerUserId(socket: SocketLike): number | undefined {
  const room = roomsBySocket.get(socket)
  if (!room) return undefined
  if (room.a === socket) return room.bUserId
  if (room.b === socket) return room.aUserId
  return undefined
}

export function getPartner(socket: SocketLike): SocketLike | undefined {
  const room = roomsBySocket.get(socket)
  if (!room) return undefined
  if (room.a === socket) return room.b
  if (room.b === socket) return room.a
  return undefined
}

export function blockedPairCount() {
  return blockedPairs.size
}

export function send(socket: SocketLike, message: ServerMessage) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message))
}

function genderOk(lookingFor: Gender, peerGender: Gender) {
  if (lookingFor === DEFAULT_GENDER || peerGender === DEFAULT_GENDER) return true
  return lookingFor === peerGender
}

function countryOk(a: string, b: string) {
  return a === DEFAULT_COUNTRY || b === DEFAULT_COUNTRY || a === b
}

function languageOk(a: string, b: string) {
  return a === DEFAULT_LANGUAGE || b === DEFAULT_LANGUAGE || a === b
}

function interestScore(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  return a.filter((x) => setB.has(x)).length
}

function compatible(a: QueuePeer, b: QueuePeer) {
  if (a.socket === b.socket) return false
  if (isBlockedPair(a.userId, b.userId)) return false
  if (!a.preferences.allowMatchWithSameUsers && isRecentPair(a, b)) return false
  const pa = a.preferences
  const pb = b.preferences
  if (!countryOk(pa.country, pb.country)) return false
  if (!languageOk(pa.language, pb.language)) return false
  if (!genderOk(pa.lookingFor, pb.gender)) return false
  if (!genderOk(pb.lookingFor, pa.gender)) return false
  return true
}

function score(a: QueuePeer, b: QueuePeer) {
  return interestScore(a.preferences.interests, b.preferences.interests)
}

export function normalizePreferences(raw: unknown): MatchPreferences | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const country = typeof p.country === 'string' ? p.country.slice(0, 8) : DEFAULT_COUNTRY
  const language = typeof p.language === 'string' ? p.language.slice(0, 16) : DEFAULT_LANGUAGE
  const gender = GENDERS.includes(p.gender as Gender) ? (p.gender as Gender) : DEFAULT_GENDER
  const lookingFor = GENDERS.includes(p.lookingFor as Gender) ? (p.lookingFor as Gender) : DEFAULT_GENDER
  const interests = Array.isArray(p.interests)
    ? p.interests.filter((x): x is string => typeof x === 'string').slice(0, 10)
    : []
  const allowMatchWithSameUsers = typeof p.allowMatchWithSameUsers === 'boolean' ? p.allowMatchWithSameUsers : true
  return { country, language, gender, lookingFor, interests, allowMatchWithSameUsers }
}

export function removeFromQueue(socket: SocketLike) {
  const idx = waiting.findIndex((p) => p.socket === socket)
  if (idx >= 0) waiting.splice(idx, 1)
}

export function leaveRoom(socket: SocketLike, notifyPartner = true, reason?: string) {
  const room = roomsBySocket.get(socket)
  const partner = partners.get(socket)
  const meta = peerMeta.get(socket)
  if (meta?.userId) unregisterUserSocket(meta.userId, socket)
  if (partner) {
    partners.delete(socket)
    partners.delete(partner)
    const partnerMeta = peerMeta.get(partner)
    if (partnerMeta?.userId) unregisterUserSocket(partnerMeta.userId, socket)
    if (notifyPartner) send(partner, { type: WS_MESSAGE_TYPE.roomPeerLeft, reason })
  }
  if (room) {
    roomsBySocket.delete(room.a)
    roomsBySocket.delete(room.b)
  }
  peerMeta.delete(socket)
}

export function fullRemove(socket: SocketLike) {
  const meta = peerMeta.get(socket)
  if (meta?.userId) unregisterUserSocket(meta.userId, socket)
  removeFromQueue(socket)
  leaveRoom(socket, true, PEER_LEFT_REASON.disconnect)
}

export function queueStats() {
  return { waiting: waiting.length, online: partners.size + waiting.length }
}

export function broadcastStats() {
  const stats = queueStats()
  const msg: ServerMessage = { type: WS_MESSAGE_TYPE.stats, online: stats.online, waiting: stats.waiting }
  for (const peer of waiting) send(peer.socket, msg)
  for (const socket of partners.keys()) send(socket, msg)
}

let roomSeq = 0
function newRoomId() {
  roomSeq += 1
  return `room_${Date.now().toString(36)}_${roomSeq}`
}

export function joinQueue(
  socket: SocketLike,
  preferences: MatchPreferences,
  opts: { userId?: number; email?: string; sessionKey: string },
) {
  removeFromQueue(socket)
  leaveRoom(socket, true, PEER_LEFT_REASON.requeue)

  const self: QueuePeer = {
    socket,
    preferences,
    userId: opts.userId,
    email: opts.email,
    sessionKey: opts.sessionKey,
    joinedAt: Date.now(),
    lastBeat: Date.now(),
  }
  peerMeta.set(socket, self)
  if (opts.userId) registerUserSocket(opts.userId, socket)

  let bestIdx = -1
  let bestScore = -1
  for (let i = 0; i < waiting.length; i++) {
    const candidate = waiting[i]!
    if (!compatible(self, candidate)) continue
    const s = score(self, candidate)
    if (s > bestScore) {
      bestScore = s
      bestIdx = i
    }
  }

  if (bestIdx >= 0) {
    const partner = waiting.splice(bestIdx, 1)[0]!
    rememberPair(self, partner)
    const room: Room = {
      id: newRoomId(),
      a: socket,
      b: partner.socket,
      aUserId: self.userId,
      bUserId: partner.userId,
      createdAt: Date.now(),
    }
    partners.set(socket, partner.socket)
    partners.set(partner.socket, socket)
    roomsBySocket.set(socket, room)
    roomsBySocket.set(partner.socket, room)
    const sharedInterests = preferences.interests.filter((x) => partner.preferences.interests.includes(x))
    const selfUserId = self.userId
    const partnerUserId = partner.userId
    let relSelf: RelationshipStatus = 'none'
    let relPartner: RelationshipStatus = 'none'
    if (selfUserId && partnerUserId) {
      relSelf = await getRelationship(selfUserId, partnerUserId)
      relPartner = await getRelationship(partnerUserId, selfUserId)
    }
    send(socket, {
      type: WS_MESSAGE_TYPE.roomMatched,
      roomId: room.id,
      role: ROLE.offerer as Role,
      peerCountry: partner.preferences.country,
      peerEmail: partner.email,
      peerUserId: partner.userId,
      sharedInterests,
      relationship: relSelf,
    })
    send(partner.socket, {
      type: WS_MESSAGE_TYPE.roomMatched,
      roomId: room.id,
      role: ROLE.answerer as Role,
      peerCountry: preferences.country,
      peerEmail: self.email,
      peerUserId: self.userId,
      sharedInterests,
      relationship: relPartner,
    })
    const waitMs = Date.now() - partner.joinedAt
    observeMs(METRIC_NAMES.matchWait, waitMs)
    inc(METRIC_NAMES.matchesTotal)
    broadcastStats()
    return
  }

  waiting.push(self)
  inc(METRIC_NAMES.queueJoins)
  send(socket, {
    type: WS_MESSAGE_TYPE.queueWaiting,
    position: waiting.length,
    online: queueStats().online,
  })
  broadcastStats()
}

export function heartbeat(socket: SocketLike) {
  const meta = peerMeta.get(socket)
  if (meta) meta.lastBeat = Date.now()
  const inQueue = waiting.find((p) => p.socket === socket)
  if (inQueue) inQueue.lastBeat = Date.now()
}

export function getSocketForUser(userId: number): SocketLike | undefined {
  const sockets = userSockets.get(userId)
  if (!sockets) return undefined
  // Return the first connected socket
  for (const socket of sockets) {
    if (socket.readyState === 1) return socket
  }
  return undefined
}

export function registerUserSocket(userId: number, socket: SocketLike) {
  if (!userId) return
  if (!userSockets.has(userId)) userSockets.set(userId, new Set())
  userSockets.get(userId)!.add(socket)
}

export function unregisterUserSocket(userId: number, socket: SocketLike) {
  const sockets = userSockets.get(userId)
  if (sockets) {
    sockets.delete(socket)
    if (sockets.size === 0) userSockets.delete(userId)
  }
}

export function getRoom(socket: SocketLike) {
  return roomsBySocket.get(socket)
}

export function getMeta(socket: SocketLike) {
  return peerMeta.get(socket)
}

/** Drop queue entries that stopped heartbeating */
export function purgeStale(maxAgeMs = 45_000) {
  const now = Date.now()
  for (let i = waiting.length - 1; i >= 0; i--) {
    const peer = waiting[i]!
    if (now - peer.lastBeat > maxAgeMs) {
      waiting.splice(i, 1)
      send(peer.socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.queueTimeout, message: 'Queue timed out. Try again.' })
      peerMeta.delete(peer.socket)
    }
  }
}

setInterval(() => purgeStale(), 15_000).unref?.()

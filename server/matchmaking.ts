import type { Gender, MatchPreferences, ServerMessage } from '../shared/types'
import {
  DEFAULT_COUNTRY,
  DEFAULT_GENDER,
  DEFAULT_LANGUAGE,
  GENDERS,
  METRIC_NAMES,
  PEER_LEFT_REASON,
  SERVER_ERROR_CODE,
  WS_MESSAGE_TYPE,
} from '../shared/constants'
import { inc, observeMs } from './metrics'

export type SocketLike = {
  send: (message: string) => void
  readyState: number
}

export type QueuePeer = {
  socket: SocketLike
  preferences: MatchPreferences
  userId?: number
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

function pairKeyUsers(a: number, b: number) {
  return a < b ? `u:${a}:${b}` : `u:${b}:${a}`
}

function pairKeySessions(a: string, b: string) {
  return a < b ? `s:${a}:${b}` : `s:${b}:${a}`
}

export function blockPair(a: number, b: number) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`
  blockedPairs.add(key)
}

export function unblockPair(a: number, b: number) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`
  blockedPairs.delete(key)
}

export function isBlockedPair(a?: number, b?: number) {
  if (!a || !b) return false
  const key = a < b ? `${a}:${b}` : `${b}:${a}`
  return blockedPairs.has(key)
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
  if (isRecentPair(a, b)) return false
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
  return { country, language, gender, lookingFor, interests }
}

export function removeFromQueue(socket: SocketLike) {
  const idx = waiting.findIndex((p) => p.socket === socket)
  if (idx >= 0) waiting.splice(idx, 1)
}

export function leaveRoom(socket: SocketLike, notifyPartner = true, reason?: string) {
  const room = roomsBySocket.get(socket)
  const partner = partners.get(socket)
  if (partner) {
    partners.delete(socket)
    partners.delete(partner)
    if (notifyPartner) send(partner, { type: 'room:peer-left', reason })
  }
  if (room) {
    roomsBySocket.delete(room.a)
    roomsBySocket.delete(room.b)
  }
  peerMeta.delete(socket)
}

export function fullRemove(socket: SocketLike) {
  removeFromQueue(socket)
  leaveRoom(socket, true, PEER_LEFT_REASON.disconnect)
}

export function queueStats() {
  return { waiting: waiting.length, online: partners.size + waiting.length }
}

export function broadcastStats() {
  const stats = queueStats()
  const msg: ServerMessage = { type: 'stats', online: stats.online, waiting: stats.waiting }
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
  opts: { userId?: number; sessionKey: string },
) {
  removeFromQueue(socket)
  leaveRoom(socket, true, PEER_LEFT_REASON.requeue)

  const self: QueuePeer = {
    socket,
    preferences,
    userId: opts.userId,
    sessionKey: opts.sessionKey,
    joinedAt: Date.now(),
    lastBeat: Date.now(),
  }
  peerMeta.set(socket, self)

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
    send(socket, {
      type: 'room:matched',
      roomId: room.id,
      role: 'offerer',
      peerCountry: partner.preferences.country,
      sharedInterests,
    })
    send(partner.socket, {
      type: 'room:matched',
      roomId: room.id,
      role: 'answerer',
      peerCountry: preferences.country,
      sharedInterests,
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
    type: 'queue:waiting',
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

export function getPartner(socket: SocketLike) {
  return partners.get(socket)
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

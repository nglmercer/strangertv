import type { Gender, GroupVisibility, MatchMode, MatchPreferences, MatchScope, Role, ServerMessage, RelationshipStatus } from '../../shared/types'
import { DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE, GENDERS, GROUP_VISIBILITY, MATCH_MODE, MATCH_SCOPE, METRIC_NAMES, PEER_LEFT_REASON, ROLE, SERVER_ERROR_CODE, WS_MESSAGE_TYPE } from '../../shared/constants'
import { inc, observeMs } from '../metrics'
import { getRelationship } from '../messages'
import type { SocketLike, QueuePeer, Room, GroupRoom } from './types'
import { getSocketForUser, getAllSocketsForUser, registerUserSocket, unregisterUserSocket, getSocketUserId } from './sockets'
export { getSocketForUser, getAllSocketsForUser, registerUserSocket, unregisterUserSocket, getSocketUserId } from './sockets'
import { waitingPeers, waitingGroups, partners, roomsBySocket, groupRoomsBySocket, groupRoomsById, peerMeta, blockedPairs, recentPairs, userSockets, socketUsers, RECENT_COOLDOWN_MS, newRoomId, newGroupRoomId } from './state'
import { db } from '../db'

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
  if (recentPairs.size > 5000) {
    for (const [k, exp] of recentPairs) {
      if (exp <= Date.now()) recentPairs.delete(k)
    }
  }
}

export function rematchCooldownMs() {
  return RECENT_COOLDOWN_MS
}

export function hydrateBlocks(rows: Array<{ blocker_id: unknown; blocked_id: unknown }>) {
  for (const row of rows) {
    const a = Number(row.blocker_id)
    const b = Number(row.blocked_id)
    if (a && b) blockPair(a, b)
  }
}

export function getMeta(socket: SocketLike) {
  return peerMeta.get(socket)
}

export function getRoom(socket: SocketLike) {
  return roomsBySocket.get(socket)
}

export function getGroupRoom(socket: SocketLike): GroupRoom | undefined {
  return groupRoomsBySocket.get(socket)
}

export function getGroupRoomById(roomId: string): GroupRoom | undefined {
  return groupRoomsById.get(roomId)
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
  const mode = p.mode === MATCH_MODE.group ? MATCH_MODE.group : MATCH_MODE.solo
  const matchScope = p.matchScope === MATCH_SCOPE.solo || p.matchScope === MATCH_SCOPE.group ? p.matchScope : MATCH_SCOPE.all
  return { country, language, gender, lookingFor, interests, allowMatchWithSameUsers, mode, matchScope }
}

export function removeFromQueue(socket: SocketLike) {
  const idx = waitingPeers.findIndex((p) => p.socket === socket)
  if (idx >= 0) waitingPeers.splice(idx, 1)
  const grpIdx = waitingGroups.findIndex((g) => g.hostSocket === socket)
  if (grpIdx >= 0) {
    const group = waitingGroups[grpIdx]!
    if (group.inQueue) {
      waitingGroups.splice(grpIdx, 1)
      group.inQueue = false
    }
  }
}

export function leaveGroup(socket: SocketLike, reason?: string): GroupRoom | undefined {
  const group = groupRoomsBySocket.get(socket)
  if (!group) return undefined

  const participant = group.participants.get(socket)
  group.participants.delete(socket)
  groupRoomsBySocket.delete(socket)

  if (participant?.userId) unregisterUserSocket(participant.userId, socket)

  if (group.hostSocket === socket) {
    const participantSockets = Array.from(group.participants.keys())
    for (const sock of participantSockets) {
      send(sock, { type: WS_MESSAGE_TYPE.roomPeerLeft, reason: reason || PEER_LEFT_REASON.hostLeft })
      groupRoomsBySocket.delete(sock)
    }
    group.participants.clear()
    if (group.inQueue) {
      const idx = waitingGroups.indexOf(group)
      if (idx >= 0) waitingGroups.splice(idx, 1)
      group.inQueue = false
    }
    groupRoomsById.delete(group.id)
    return group
  }

  for (const [sock] of group.participants) {
    send(sock, { type: WS_MESSAGE_TYPE.groupMatchParticipantLeft, roomId: group.id, userId: participant?.userId ?? 0 })
  }

  if (group.participants.size === 0) {
    if (group.inQueue) {
      const idx = waitingGroups.indexOf(group)
      if (idx >= 0) waitingGroups.splice(idx, 1)
      group.inQueue = false
    }
    groupRoomsById.delete(group.id)
  }

  return group
}

export function leaveRoom(socket: SocketLike, notifyPartner = true, reason?: string) {
  const room = roomsBySocket.get(socket)
  const partner = partners.get(socket)
  const meta = peerMeta.get(socket)
  console.debug('[mm] leaveRoom', { userId: meta?.userId, roomId: room?.id, partnerId: partner ? peerMeta.get(partner)?.userId : undefined, notifyPartner, reason })
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
  leaveGroup(socket, PEER_LEFT_REASON.disconnect)
  leaveRoom(socket, true, PEER_LEFT_REASON.disconnect)
}

export function queueStats() {
  const groupParticipants = waitingGroups.reduce((sum, g) => sum + g.participants.size, 0)
  return { waiting: waitingPeers.length + groupParticipants, online: partners.size + waitingPeers.length + groupParticipants }
}

export function broadcastStats() {
  const stats = queueStats()
  const msg: ServerMessage = { type: WS_MESSAGE_TYPE.stats, online: stats.online, waiting: stats.waiting }
  for (const peer of waitingPeers) send(peer.socket, msg)
  for (const group of waitingGroups) {
    for (const [sock] of group.participants) send(sock, msg)
  }
  for (const socket of partners.keys()) send(socket, msg)
}

async function buildPeer(userId: number, socket: SocketLike): Promise<QueuePeer | null> {
  const meta = peerMeta.get(socket)
  if (meta) return meta
  const user = await db.execute({ sql: 'SELECT email, gender, country, language, interests FROM users WHERE id = ?', args: [userId] })
  const row = user.rows[0] as unknown as { email: string; gender: string; country: string; language: string; interests: string } | undefined
  if (!row) return null
  return {
    socket,
    preferences: normalizePreferences({
      gender: row.gender,
      country: row.country,
      language: row.language,
      interests: row.interests ? JSON.parse(row.interests) : [],
      lookingFor: 'any',
      mode: MATCH_MODE.solo,
      matchScope: MATCH_SCOPE.all,
    })!,
    userId,
    email: row.email,
    sessionKey: '',
    joinedAt: Date.now(),
    lastBeat: Date.now(),
  }
}

export async function matchUsers(aUserId: number, bUserId: number): Promise<boolean> {
  const aSockets = getAllSocketsForUser(aUserId)
  const bSockets = getAllSocketsForUser(bUserId)
  if (aSockets.length === 0 || bSockets.length === 0) return false

  const aSocket = aSockets[0]
  const bSocket = bSockets[0]

  const aMeta = await buildPeer(aUserId, aSocket)
  const bMeta = await buildPeer(bUserId, bSocket)
  if (!aMeta || !bMeta) return false

  for (const s of aSockets) leaveRoom(s, false, PEER_LEFT_REASON.leave)
  for (const s of bSockets) leaveRoom(s, false, PEER_LEFT_REASON.leave)

  const room: Room = {
    id: newRoomId(),
    a: aSocket,
    b: bSocket,
    aUserId,
    bUserId,
    createdAt: Date.now(),
    mode: MATCH_MODE.solo,
  }
  partners.set(aSocket, bSocket)
  partners.set(bSocket, aSocket)
  roomsBySocket.set(aSocket, room)
  roomsBySocket.set(bSocket, room)

  const sharedInterests = aMeta.preferences.interests.filter((x) => bMeta.preferences.interests.includes(x))
  const relA = await getRelationship(aUserId, bUserId)
  const relB = await getRelationship(bUserId, aUserId)

  console.debug('[mm] invitation:matched', { roomId: room.id, aUserId, bUserId })

  const payloadA = {
    type: WS_MESSAGE_TYPE.roomMatched,
    roomId: room.id,
    role: ROLE.offerer as Role,
    peerCountry: bMeta.preferences.country,
    peerEmail: bMeta.email,
    peerUserId: bUserId,
    sharedInterests,
    relationship: relA,
  }
  const payloadB = {
    type: WS_MESSAGE_TYPE.roomMatched,
    roomId: room.id,
    role: ROLE.answerer as Role,
    peerCountry: aMeta.preferences.country,
    peerEmail: aMeta.email,
    peerUserId: aUserId,
    sharedInterests,
    relationship: relB,
  }

  // Deliver to ALL open sockets so the match appears in every tab
  for (const s of aSockets) send(s, payloadA)
  for (const s of bSockets) send(s, payloadB)

  broadcastStats()
  return true
}

export async function joinQueue(
  socket: SocketLike,
  preferences: MatchPreferences,
  opts: { userId?: number; email?: string; sessionKey: string },
) {
  removeFromQueue(socket)
  leaveRoom(socket, true, PEER_LEFT_REASON.requeue)
  leaveGroup(socket, PEER_LEFT_REASON.requeue)

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
  if (preferences.matchScope !== MATCH_SCOPE.group) {
    for (let i = 0; i < waitingPeers.length; i++) {
      const candidate = waitingPeers[i]!
      if (candidate.preferences.matchScope === MATCH_SCOPE.group) continue
      if (!compatible(self, candidate)) continue
      const s = score(self, candidate)
      if (s > bestScore) {
        bestScore = s
        bestIdx = i
      }
    }
  }

  if (bestIdx >= 0) {
    const partner = waitingPeers.splice(bestIdx, 1)[0]!
    rememberPair(self, partner)
    const room: Room = {
      id: newRoomId(),
      a: socket,
      b: partner.socket,
      aUserId: self.userId,
      bUserId: partner.userId,
      createdAt: Date.now(),
      mode: MATCH_MODE.solo,
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
    console.debug('[mm] matched', { roomId: room.id, aUserId: self.userId, bUserId: partner.userId, relSelf, relPartner })
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

  if (preferences.matchScope !== MATCH_SCOPE.solo) {
    const group = findBestGroupForSolo(self)
    if (group) {
      const waitMs = Date.now() - (group.createdAt ?? Date.now())
      mergeSoloWithGroup(self, group)
      observeMs(METRIC_NAMES.matchWait, waitMs)
      broadcastStats()
      return
    }
  }

  waitingPeers.push(self)
  inc(METRIC_NAMES.queueJoins)
  send(socket, {
    type: WS_MESSAGE_TYPE.queueWaiting,
    position: waitingPeers.length,
    online: queueStats().online,
  })
  broadcastStats()
}

export function createGroupMatchRoom(
  socket: SocketLike,
  visibility: GroupVisibility,
  preferences: MatchPreferences,
  opts: { userId?: number; email?: string; sessionKey: string; skipLeaveRoom?: boolean },
): string {
  leaveGroup(socket)
  if (!opts.skipLeaveRoom) {
    leaveRoom(socket, true, PEER_LEFT_REASON.groupInvite)
  }

  const roomId = newGroupRoomId()
  const participants = new Map<SocketLike, { userId?: number; email?: string; preferences: MatchPreferences; sessionKey: string }>()
  participants.set(socket, {
    userId: opts.userId,
    email: opts.email,
    preferences,
    sessionKey: opts.sessionKey,
  })

  const group: GroupRoom = {
    id: roomId,
    hostSocket: socket,
    hostUserId: opts.userId,
    hostEmail: opts.email,
    visibility,
    scope: preferences.matchScope,
    preferences,
    participants,
    createdAt: Date.now(),
    inQueue: false,
  }

  groupRoomsBySocket.set(socket, group)
  groupRoomsById.set(roomId, group)

  if (opts.userId) registerUserSocket(opts.userId, socket)

  send(socket, { type: WS_MESSAGE_TYPE.groupMatchCreated, roomId, visibility })
  return roomId
}

export function addParticipantToGroup(
  group: GroupRoom,
  socket: SocketLike,
  opts: { userId?: number; email?: string; preferences: MatchPreferences; sessionKey: string },
) {
  // Clean up any prior match/queue state for the joining socket
  removeFromQueue(socket)
  const existingRoom = roomsBySocket.get(socket)
  if (existingRoom) {
    const partnerSocket = partners.get(socket)
    if (partnerSocket) {
      partners.delete(socket)
      partners.delete(partnerSocket)
      roomsBySocket.delete(socket)
      roomsBySocket.delete(partnerSocket)
      send(partnerSocket, { type: WS_MESSAGE_TYPE.roomPeerLeft, reason: PEER_LEFT_REASON.requeue })
    } else {
      roomsBySocket.delete(socket)
    }
  }

  group.participants.set(socket, opts)
  groupRoomsBySocket.set(socket, group)
  if (opts.userId) registerUserSocket(opts.userId, socket)
  for (const [sock, p] of group.participants) {
    if (sock !== socket) {
      send(sock, { type: WS_MESSAGE_TYPE.groupMatchParticipantJoined, roomId: group.id, userId: opts.userId ?? 0, email: opts.email })
    }
  }
  send(socket, { type: WS_MESSAGE_TYPE.groupMatchCreated, roomId: group.id, visibility: group.visibility })

  // Auto-enter matchmaking queue when group reaches 2+ participants
  if (group.participants.size >= 2) {
    if (!group.inQueue) {
      group.inQueue = true
      waitingGroups.push(group)
      for (const [sock] of group.participants) {
        send(sock, {
          type: WS_MESSAGE_TYPE.queueWaiting,
          position: waitingGroups.length,
          online: queueStats().online,
        })
      }
    }
    tryMatchGroup(group)
  }
}

export function startGroupMatch(group: GroupRoom) {
  if (group.inQueue) return
  group.inQueue = true
  waitingGroups.push(group)

  for (const [sock] of group.participants) {
    send(sock, {
      type: WS_MESSAGE_TYPE.queueWaiting,
      position: waitingGroups.length,
      online: queueStats().online,
    })
  }

  tryMatchGroup(group)
}

function tryMatchGroup(group: GroupRoom) {
  if (!group.inQueue) return

  let bestGroup: GroupRoom | null = null
  let bestScore = -1

  for (const candidate of waitingGroups) {
    if (candidate === group) continue
    if (!groupToGroupCompatible(group, candidate)) continue
    const s = computeGroupPairScore(group, candidate)
    if (s > bestScore) {
      bestScore = s
      bestGroup = candidate
    }
  }

  if (bestGroup) {
    mergeGroupsAndMatch(group, bestGroup)
    return
  }

  if (group.scope !== MATCH_SCOPE.group) {
    const peer = findBestSoloForGroup(group)
    if (peer) {
      mergeSoloWithGroup(peer, group)
      return
    }
  }

  if (group.participants.size >= 2) {
    const idx = waitingGroups.indexOf(group)
    if (idx >= 0) waitingGroups.splice(idx, 1)
    group.inQueue = false
    const sharedInterests = computeSharedInterests(toSide(group))
    notifyGroupMatch([toSide(group)], sharedInterests)
    inc(METRIC_NAMES.matchesTotal)
  }
}

function computeGroupPairScore(a: GroupRoom, b: GroupRoom): number {
  let total = 0
  for (const [, pa] of a.participants) {
    for (const [, pb] of b.participants) {
      total += interestScore(pa.preferences.interests, pb.preferences.interests)
    }
  }
  return total
}

function findBestSoloForGroup(group: GroupRoom): QueuePeer | null {
  let best: QueuePeer | null = null
  let bestScore = -1
  for (const candidate of waitingPeers) {
    if (candidate.preferences.matchScope === MATCH_SCOPE.solo) continue
    if (!groupPeerCompatible(candidate, group)) continue
    const groupPrefs = aggregateGroupPreferences(group)
    const candidatePeer: QueuePeer = { ...candidate, preferences: candidate.preferences }
    const groupPeer: QueuePeer = {
      socket: null as unknown as SocketLike,
      preferences: groupPrefs,
      joinedAt: 0,
      lastBeat: 0,
      sessionKey: '',
    }
    if (!compatible(candidatePeer, groupPeer)) continue
    const s = score(candidatePeer, groupPeer)
    if (s > bestScore) {
      bestScore = s
      best = candidate
    }
  }
  return best
}

function findBestGroupForSolo(peer: QueuePeer): GroupRoom | null {
  let best: GroupRoom | null = null
  let bestScore = -1
  for (const group of waitingGroups) {
    if (group.scope === MATCH_SCOPE.group) continue
    if (!groupPeerCompatible(peer, group)) continue
    const groupPrefs = aggregateGroupPreferences(group)
    const groupPeer: QueuePeer = {
      socket: null as unknown as SocketLike,
      preferences: groupPrefs,
      joinedAt: 0,
      lastBeat: 0,
      sessionKey: '',
    }
    if (!compatible(peer, groupPeer)) continue
    const s = score(peer, groupPeer)
    if (s > bestScore) {
      bestScore = s
      best = group
    }
  }
  return best
}

function aggregateGroupPreferences(group: GroupRoom): MatchPreferences {
  const allInterests = new Set<string>()
  let country = DEFAULT_COUNTRY
  let language = DEFAULT_LANGUAGE
  for (const [, p] of group.participants) {
    p.preferences.interests.forEach((i) => allInterests.add(i))
    if (p.preferences.country !== DEFAULT_COUNTRY) country = p.preferences.country
    if (p.preferences.language !== DEFAULT_LANGUAGE) language = p.preferences.language
  }
  return {
    country,
    language,
    gender: group.preferences.gender,
    lookingFor: group.preferences.lookingFor,
    interests: Array.from(allInterests).slice(0, 10),
    allowMatchWithSameUsers: true,
    mode: MATCH_MODE.group,
    matchScope: group.scope,
  }
}

type SideParticipant = {
  socket: SocketLike
  userId?: number
  email?: string
  preferences: MatchPreferences
}

function toSide(group: GroupRoom): SideParticipant[] {
  const side: SideParticipant[] = []
  for (const [sock, p] of group.participants) {
    side.push({ socket: sock, userId: p.userId, email: p.email, preferences: p.preferences })
  }
  return side
}

function rememberGroupPair(peer: QueuePeer, group: GroupRoom) {
  const host: QueuePeer = {
    socket: group.hostSocket,
    userId: group.hostUserId,
    email: group.hostEmail,
    preferences: group.preferences,
    sessionKey: '',
    joinedAt: 0,
    lastBeat: 0,
  }
  rememberPair(peer, host)
}

function mergeSoloWithGroup(peer: QueuePeer, group: GroupRoom) {
  const idx = waitingPeers.indexOf(peer)
  if (idx >= 0) waitingPeers.splice(idx, 1)
  const gIdx = waitingGroups.indexOf(group)
  if (gIdx >= 0) waitingGroups.splice(gIdx, 1)
  group.inQueue = false

  const sharedInterests = computeSharedInterests([...toSide(group), { socket: peer.socket, userId: peer.userId, email: peer.email, preferences: peer.preferences }])
  notifyGroupMatch([toSide(group), [{ socket: peer.socket, userId: peer.userId, email: peer.email, preferences: peer.preferences }]], sharedInterests)

  inc(METRIC_NAMES.matchesTotal)
  if (peer.userId) rememberGroupPair(peer, group)
}

function mergeGroupsAndMatch(a: GroupRoom, b: GroupRoom) {
  const aIdx = waitingGroups.indexOf(a)
  if (aIdx >= 0) waitingGroups.splice(aIdx, 1)
  const bIdx = waitingGroups.indexOf(b)
  if (bIdx >= 0) waitingGroups.splice(bIdx, 1)
  a.inQueue = false
  b.inQueue = false

  const sharedInterests = computeSharedInterests([...toSide(a), ...toSide(b)])
  notifyGroupMatch([toSide(a), toSide(b)], sharedInterests)

  inc(METRIC_NAMES.matchesTotal)
}

function computeSharedInterests(participants: SideParticipant[]): string[] {
  const counts = new Map<string, number>()
  let total = 0
  for (const p of participants) {
    total++
    for (const interest of p.preferences.interests) {
      counts.set(interest, (counts.get(interest) ?? 0) + 1)
    }
  }
  const result: string[] = []
  for (const [interest, count] of counts) {
    if (count >= total * 0.5) result.push(interest)
  }
  return result
}

function notifyGroupMatch(sides: SideParticipant[][], sharedInterests: string[]) {
  const openSides = sides
    .map((side) => side.filter((p) => p.socket.readyState === 1))
    .filter((side) => side.length > 0)
  const participantList = openSides.flat().map((p, index) => ({ ...p, index }))
  if (participantList.length < 2) return

  const matchedRoomId = newRoomId()

  for (const { socket } of participantList) {
    const oldGroup = groupRoomsBySocket.get(socket)
    if (oldGroup) {
      oldGroup.participants.delete(socket)
      if (oldGroup.participants.size === 0) {
        groupRoomsById.delete(oldGroup.id)
      }
    }
    groupRoomsBySocket.delete(socket)
    const staleRoom = roomsBySocket.get(socket)
    if (staleRoom) {
      roomsBySocket.delete(staleRoom.a)
      roomsBySocket.delete(staleRoom.b)
      partners.delete(socket)
    }
  }

  const unifiedGroup: GroupRoom = {
    id: matchedRoomId,
    hostSocket: participantList[0]!.socket,
    hostUserId: participantList[0]!.userId,
    hostEmail: participantList[0]!.email,
    visibility: GROUP_VISIBILITY.public,
    scope: MATCH_SCOPE.all,
    preferences: participantList[0]!.preferences,
    participants: new Map(),
    createdAt: Date.now(),
    inQueue: false,
  }

  for (const p of participantList) {
    unifiedGroup.participants.set(p.socket, {
      userId: p.userId ?? 0,
      email: p.email,
      preferences: p.preferences,
      sessionKey: '',
    })
    groupRoomsBySocket.set(p.socket, unifiedGroup)
  }
  groupRoomsById.set(matchedRoomId, unifiedGroup)

  const socketToSide = new Map<SocketLike, number>()
  openSides.forEach((side, sideIdx) => {
    for (const p of side) socketToSide.set(p.socket, sideIdx)
  })

  for (const self of participantList) {
    const selfSide = socketToSide.get(self.socket) ?? 0
    const peers = participantList
      .filter((p) => p.socket !== self.socket)
      .map((p) => ({
        userId: p.userId ?? 0,
        email: p.email,
        country: p.preferences.country !== DEFAULT_COUNTRY ? p.preferences.country : undefined,
        role: (self.index < p.index ? ROLE.offerer : ROLE.answerer) as Role,
        side: (socketToSide.get(p.socket) === selfSide ? 'local' : 'remote') as 'local' | 'remote',
      }))

    send(self.socket, {
      type: WS_MESSAGE_TYPE.groupMatchMatched,
      roomId: matchedRoomId,
      role: self.index === 0 ? ROLE.offerer : ROLE.answerer,
      peers,
      sharedInterests,
    })
  }
}

export function heartbeat(socket: SocketLike) {
  const meta = peerMeta.get(socket)
  if (meta) meta.lastBeat = Date.now()
  const inQueue = waitingPeers.find((p) => p.socket === socket)
  if (inQueue) {
    inQueue.lastBeat = Date.now()
    if (inQueue.preferences.matchScope !== MATCH_SCOPE.solo) {
      const group = findBestGroupForSolo(inQueue)
      if (group) {
        mergeSoloWithGroup(inQueue, group)
        broadcastStats()
      }
    }
    return
  }
  const group = groupRoomsBySocket.get(socket)
  if (group?.inQueue) tryMatchGroup(group)
}

export function purgeStale(maxAgeMs = 45_000) {
  const now = Date.now()
  for (let i = waitingPeers.length - 1; i >= 0; i--) {
    const peer = waitingPeers[i]!
    if (now - peer.lastBeat > maxAgeMs) {
      waitingPeers.splice(i, 1)
      send(peer.socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.queueTimeout, message: 'Queue timed out. Try again.' })
      peerMeta.delete(peer.socket)
    }
  }
}

function groupPeerCompatible(peer: QueuePeer, group: GroupRoom): boolean {
  for (const [, participant] of group.participants) {
    const pp: QueuePeer = {
      socket: null as unknown as SocketLike,
      preferences: participant.preferences,
      userId: participant.userId,
      email: participant.email,
      sessionKey: participant.sessionKey,
      joinedAt: 0,
      lastBeat: 0,
    }
    if (!compatible(peer, pp)) return false
  }
  return true
}

function groupToGroupCompatible(a: GroupRoom, b: GroupRoom): boolean {
  for (const [, pa] of a.participants) {
    for (const [, pb] of b.participants) {
      const peerA: QueuePeer = {
        socket: null as unknown as SocketLike,
        preferences: pa.preferences,
        userId: pa.userId,
        sessionKey: pa.sessionKey,
        joinedAt: 0,
        lastBeat: 0,
      }
      const peerB: QueuePeer = {
        socket: null as unknown as SocketLike,
        preferences: pb.preferences,
        userId: pb.userId,
        sessionKey: pb.sessionKey,
        joinedAt: 0,
        lastBeat: 0,
      }
      if (!compatible(peerA, peerB)) return false
    }
  }
  return true
}

export function getUserSocketDebug(userId: number) {
  const sockets = userSockets.get(userId)
  if (!sockets) return { count: 0, readyStates: [] }
  return { count: sockets.size, readyStates: Array.from(sockets).map((s) => s.readyState) }
}

setInterval(() => purgeStale(), 15_000).unref?.()



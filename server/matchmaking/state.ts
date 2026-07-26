import type { GroupRoom, QueuePeer, Room, SocketLike } from './types'

export const waitingPeers: QueuePeer[] = []
export const waitingGroups: GroupRoom[] = []
export const partners = new Map<SocketLike, SocketLike>()
export const roomsBySocket = new Map<SocketLike, Room>()
export const groupRoomsBySocket = new Map<SocketLike, GroupRoom>()
export const groupRoomsById = new Map<string, GroupRoom>()
export const peerMeta = new Map<SocketLike, QueuePeer>()
export const blockedPairs = new Set<string>()
export const recentPairs = new Map<string, number>()
export const userSockets = new Map<number, Set<SocketLike>>()
export const socketUsers = new Map<SocketLike, number>()

export const RECENT_COOLDOWN_MS = Number(process.env.REMATCH_COOLDOWN_MS ?? 10 * 60_000)

let roomSeq = 0
export function newRoomId() {
  roomSeq += 1
  return `room_${Date.now().toString(36)}_${roomSeq}`
}

let groupRoomSeq = 0
export function newGroupRoomId() {
  groupRoomSeq += 1
  return `groom_${Date.now().toString(36)}_${groupRoomSeq}`
}

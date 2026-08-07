import type { Gender, GroupVisibility, MatchMode, MatchPreferences, MatchScope, Role, ServerMessage, RelationshipStatus } from '../../shared/types'

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
  mode?: MatchMode
  participants?: Map<SocketLike, { userId?: number; email?: string; preferences: MatchPreferences }>
}

export type GroupRoom = {
  id: string
  hostSocket: SocketLike
  hostUserId?: number
  hostEmail?: string
  visibility: GroupVisibility
  scope: MatchScope
  preferences: MatchPreferences
  participants: Map<SocketLike, { userId?: number; email?: string; preferences: MatchPreferences; sessionKey: string; peerId?: number }>
  createdAt: number
  inQueue: boolean
  /** True once this room is a live match (post notifyGroupMatch). Leaves degrade gracefully instead of dissolving the room. */
  matched?: boolean
  /** True while the room is a live match between its own members only and is still queued looking for an opposing side. */
  searching?: boolean
}

export type { Gender, GroupVisibility, MatchMode, MatchPreferences, MatchScope, Role, ServerMessage, RelationshipStatus }

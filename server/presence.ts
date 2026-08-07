import { db } from './db'
import { getAllSocketsForUser, send, type SocketLike } from './matchmaking'
import { WS_MESSAGE_TYPE } from '../shared/constants'
import type { ServerMessage } from '../shared/types'

/**
 * Friend presence over the existing WebSocket.
 *
 * "Online" means the user has at least one authenticated socket open. On
 * connect we tell the user which friends are already online and tell those
 * friends about the newcomer; on disconnect (last socket gone) we do the
 * reverse. Without this the client had no source for presence at all and
 * rendered everyone as offline.
 */
async function acceptedFriendIds(userId: number): Promise<number[]> {
  const result = await db.execute({
    sql: `SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END AS friend_id
          FROM friends
          WHERE status = 'accepted' AND (user_a_id = ? OR user_b_id = ?)`,
    args: [userId, userId, userId],
  })
  return result.rows.map((row) => Number(row.friend_id)).filter(Boolean)
}

function broadcast(userIds: number[], message: ServerMessage) {
  for (const id of userIds) {
    for (const socket of getAllSocketsForUser(id)) send(socket, message)
  }
}

/** Call right after a socket authenticates. */
export async function announceOnline(userId: number, socket: SocketLike) {
  const friendIds = await acceptedFriendIds(userId)
  if (friendIds.length === 0) return
  const online = friendIds.filter((id) => getAllSocketsForUser(id).length > 0)
  send(socket, { type: WS_MESSAGE_TYPE.presenceList, userIds: online } as ServerMessage)
  broadcast(friendIds, { type: WS_MESSAGE_TYPE.presenceOnline, userId } as ServerMessage)
}

/** Call after a socket is removed; no-op while other sockets of the user remain. */
export async function announceOffline(userId: number) {
  if (getAllSocketsForUser(userId).length > 0) return
  const friendIds = await acceptedFriendIds(userId)
  if (friendIds.length === 0) return
  broadcast(friendIds, { type: WS_MESSAGE_TYPE.presenceOffline, userId } as ServerMessage)
}

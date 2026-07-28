import type { SocketLike } from './types'
import { userSockets, socketUsers } from './state'

export function registerUserSocket(userId: number, socket: SocketLike) {
  if (!userId) return
  if (!userSockets.has(userId)) userSockets.set(userId, new Set())
  userSockets.get(userId)!.add(socket)
  socketUsers.set(socket, userId)
}

export function unregisterUserSocket(userId: number, socket: SocketLike) {
  const sockets = userSockets.get(userId)
  if (sockets) {
    sockets.delete(socket)
    if (sockets.size === 0) userSockets.delete(userId)
  }
  socketUsers.delete(socket)
}

export function getSocketUserId(socket: SocketLike): number | undefined {
  return socketUsers.get(socket)
}

export function getSocketForUser(userId: number): SocketLike | undefined {
  const sockets = userSockets.get(userId)
  if (!sockets) return undefined
  let last: SocketLike | undefined
  for (const socket of sockets) {
    if (socket.readyState === 1) last = socket
  }
  return last
}

export function getAllSocketsForUser(userId: number): SocketLike[] {
  const sockets = userSockets.get(userId)
  if (!sockets) return []
  return Array.from(sockets).filter((s) => s.readyState === 1)
}

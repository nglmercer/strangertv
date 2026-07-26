import { describe, it, beforeEach, expect, afterEach } from 'vitest'
import type { SocketLike } from '../server/matchmaking/types'
import { registerUserSocket, unregisterUserSocket, getAllSocketsForUser, getSocketForUser } from '../server/matchmaking/sockets'
import { userSockets, socketUsers } from '../server/matchmaking/state'

function mockSocket(readyState: number): SocketLike {
  return {
    readyState,
    send: () => {},
  }
}

describe('getAllSocketsForUser', () => {
  const userId = 999

  afterEach(() => {
    // Clean up
    const sockets = userSockets.get(userId)
    if (sockets) {
      for (const s of sockets) {
        socketUsers.delete(s)
      }
    }
    userSockets.delete(userId)
  })

  it('returns only OPEN sockets (readyState === 1)', () => {
    const closed = mockSocket(3)
    const open = mockSocket(1)
    registerUserSocket(userId, closed)
    registerUserSocket(userId, open)

    const result = getAllSocketsForUser(userId)
    expect(result.length).toBe(1)
    expect(result[0]).toBe(open)
  })

  it('returns empty array when all sockets are closed', () => {
    registerUserSocket(userId, mockSocket(3))
    registerUserSocket(userId, mockSocket(0))

    const result = getAllSocketsForUser(userId)
    expect(result.length).toBe(0)
  })

  it('returns all open sockets when multiple are open', () => {
    const open1 = mockSocket(1)
    const open2 = mockSocket(1)
    registerUserSocket(userId, open1)
    registerUserSocket(userId, open2)

    const result = getAllSocketsForUser(userId)
    expect(result.length).toBe(2)
    expect(result).toContain(open1)
    expect(result).toContain(open2)
  })

  it('getSocketForUser returns first OPEN socket only', () => {
    const closed = mockSocket(3)
    const open = mockSocket(1)
    registerUserSocket(userId, closed)
    registerUserSocket(userId, open)

    const result = getSocketForUser(userId)
    expect(result).toBe(open)
  })
})

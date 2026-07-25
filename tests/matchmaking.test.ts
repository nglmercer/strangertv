import { describe, it, expect } from 'vitest'
import {
  joinQueue,
  normalizePreferences,
  queueStats,
  fullRemove,
  type SocketLike,
} from '../server/matchmaking'

function mockSocket(): SocketLike & { messages: unknown[] } {
  const messages: unknown[] = []
  return {
    messages,
    readyState: 1,
    send(message: string) {
      messages.push(JSON.parse(message))
    },
  }
}

describe('normalizePreferences', () => {
  it('fills defaults', () => {
    const p = normalizePreferences({})
    expect(p?.country).toBe('any')
    expect(p?.lookingFor).toBe('any')
  })

  it('rejects non-objects', () => {
    expect(normalizePreferences(null)).toBeNull()
  })
})

describe('joinQueue matching', () => {
  it('matches compatible peers and assigns roles', () => {
    const a = mockSocket()
    const b = mockSocket()
    const prefs = normalizePreferences({
      country: 'PE',
      language: 'es',
      gender: 'male',
      lookingFor: 'any',
      interests: ['music'],
    })!
    joinQueue(a, prefs, { sessionKey: 'a' })
    expect(queueStats().waiting).toBe(1)
    joinQueue(b, prefs, { sessionKey: 'b' })
    expect(queueStats().waiting).toBe(0)
    const matchedA = a.messages.find((m) => (m as { type: string }).type === 'room:matched') as {
      role: string
    }
    const matchedB = b.messages.find((m) => (m as { type: string }).type === 'room:matched') as {
      role: string
    }
    expect(matchedA).toBeTruthy()
    expect(matchedB).toBeTruthy()
    // Joiner that finds a waiting peer is offerer; the waiter is answerer.
    expect(matchedA.role).toBe('answerer')
    expect(matchedB.role).toBe('offerer')
    fullRemove(a)
    fullRemove(b)
  })

  it('does not match incompatible gender filters', () => {
    const a = mockSocket()
    const b = mockSocket()
    joinQueue(
      a,
      normalizePreferences({ gender: 'male', lookingFor: 'female', country: 'any', language: 'any' })!,
      { sessionKey: 'a' },
    )
    joinQueue(
      b,
      normalizePreferences({ gender: 'male', lookingFor: 'female', country: 'any', language: 'any' })!,
      { sessionKey: 'b' },
    )
    expect(queueStats().waiting).toBe(2)
    fullRemove(a)
    fullRemove(b)
  })

  it('avoids immediate rematch of same sessions', () => {
    const a1 = mockSocket()
    const b1 = mockSocket()
    const prefs = normalizePreferences({ country: 'any', language: 'any', gender: 'any', lookingFor: 'any', allowMatchWithSameUsers: false })!
    joinQueue(a1, prefs, { sessionKey: 's-a' })
    joinQueue(b1, prefs, { sessionKey: 's-b' })
    expect(queueStats().waiting).toBe(0)
    fullRemove(a1)
    fullRemove(b1)

    const a2 = mockSocket()
    const b2 = mockSocket()
    joinQueue(a2, prefs, { sessionKey: 's-a' })
    joinQueue(b2, prefs, { sessionKey: 's-b' })
    // both waiting — not rematched due to cooldown
    expect(queueStats().waiting).toBe(2)
    fullRemove(a2)
    fullRemove(b2)
  })

  it('allows immediate rematch when allowMatchWithSameUsers is true', () => {
    const a1 = mockSocket()
    const b1 = mockSocket()
    const prefs = normalizePreferences({ country: 'any', language: 'any', gender: 'any', lookingFor: 'any', allowMatchWithSameUsers: true })!
    joinQueue(a1, prefs, { sessionKey: 's-a' })
    joinQueue(b1, prefs, { sessionKey: 's-b' })
    expect(queueStats().waiting).toBe(0)
    fullRemove(a1)
    fullRemove(b1)

    const a2 = mockSocket()
    const b2 = mockSocket()
    joinQueue(a2, prefs, { sessionKey: 's-a' })
    joinQueue(b2, prefs, { sessionKey: 's-b' })
    // matched again — cooldown bypassed when preference is enabled
    expect(queueStats().waiting).toBe(0)
    fullRemove(a2)
    fullRemove(b2)
  })
})

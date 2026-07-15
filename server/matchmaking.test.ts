import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  joinQueue,
  normalizePreferences,
  queueStats,
  fullRemove,
  type SocketLike,
} from './matchmaking'

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
    assert.equal(p?.country, 'any')
    assert.equal(p?.lookingFor, 'any')
  })

  it('rejects non-objects', () => {
    assert.equal(normalizePreferences(null), null)
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
    assert.equal(queueStats().waiting, 1)
    joinQueue(b, prefs, { sessionKey: 'b' })
    assert.equal(queueStats().waiting, 0)
    const matchedA = a.messages.find((m) => (m as { type: string }).type === 'room:matched') as {
      role: string
    }
    const matchedB = b.messages.find((m) => (m as { type: string }).type === 'room:matched') as {
      role: string
    }
    assert.ok(matchedA)
    assert.ok(matchedB)
    // Joiner that finds a waiting peer is offerer; the waiter is answerer.
    assert.equal(matchedA.role, 'answerer')
    assert.equal(matchedB.role, 'offerer')
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
    assert.equal(queueStats().waiting, 2)
    fullRemove(a)
    fullRemove(b)
  })

  it('avoids immediate rematch of same sessions', () => {
    const a1 = mockSocket()
    const b1 = mockSocket()
    const prefs = normalizePreferences({ country: 'any', language: 'any', gender: 'any', lookingFor: 'any' })!
    joinQueue(a1, prefs, { sessionKey: 's-a' })
    joinQueue(b1, prefs, { sessionKey: 's-b' })
    assert.equal(queueStats().waiting, 0)
    fullRemove(a1)
    fullRemove(b1)

    const a2 = mockSocket()
    const b2 = mockSocket()
    joinQueue(a2, prefs, { sessionKey: 's-a' })
    joinQueue(b2, prefs, { sessionKey: 's-b' })
    // both waiting — not rematched due to cooldown
    assert.equal(queueStats().waiting, 2)
    fullRemove(a2)
    fullRemove(b2)
  })
})

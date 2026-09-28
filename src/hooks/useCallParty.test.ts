import { describe, expect, it } from 'vitest'
import { peerDisplayName, resolveCallPeers } from './useCallParty'

describe('peerDisplayName', () => {
  it('uses the email local part', () => {
    expect(peerDisplayName('ada@example.com', 7)).toBe('ada')
  })

  it('falls back to the user id without an email', () => {
    expect(peerDisplayName(undefined, 7)).toBe('User 7')
    expect(peerDisplayName('  ', 7)).toBe('User 7')
  })
})

describe('resolveCallPeers', () => {
  it('resolves the 1:1 peer', () => {
    expect(
      resolveCallPeers({ myUserId: 1, peerUserId: 2, peerEmail: 'bob@example.com', groupParticipants: [] }),
    ).toEqual([{ userId: 2, name: 'bob' }])
  })

  it('excludes anonymous peers', () => {
    expect(
      resolveCallPeers({ myUserId: 1, peerUserId: null, peerEmail: null, groupParticipants: [] }),
    ).toEqual([])
    expect(
      resolveCallPeers({ myUserId: null, peerUserId: null, peerEmail: null, groupParticipants: [] }),
    ).toEqual([])
  })

  it('resolves group participants minus self and duplicates', () => {
    expect(
      resolveCallPeers({
        myUserId: 1,
        peerUserId: null,
        peerEmail: null,
        groupParticipants: [
          { userId: 1, email: 'me@example.com' },
          { userId: 2, email: 'bob@example.com' },
          { userId: 3 },
          { userId: 2, email: 'bob@example.com' },
          { userId: 0 },
        ],
      }),
    ).toEqual([
      { userId: 2, name: 'bob' },
      { userId: 3, name: 'User 3' },
    ])
  })
})

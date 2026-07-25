import { describe, it, expect } from 'vitest'
import { blockPair, hydrateBlocks, isBlockedPair, blockedPairCount } from '../server/matchmaking'

describe('block pairs', () => {
  it('blocks both orderings', () => {
    blockPair(10, 20)
    expect(isBlockedPair(10, 20)).toBe(true)
    expect(isBlockedPair(20, 10)).toBe(true)
    expect(isBlockedPair(10, 21)).toBe(false)
  })

  it('hydrates from db-like rows', () => {
    const before = blockedPairCount()
    hydrateBlocks([
      { blocker_id: 1, blocked_id: 2 },
      { blocker_id: 3, blocked_id: 4 },
    ])
    expect(isBlockedPair(1, 2)).toBe(true)
    expect(isBlockedPair(3, 4)).toBe(true)
    expect(blockedPairCount()).toBeGreaterThanOrEqual(before + 2)
  })
})

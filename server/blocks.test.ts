import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { blockPair, hydrateBlocks, isBlockedPair, blockedPairCount } from './matchmaking'

describe('block pairs', () => {
  it('blocks both orderings', () => {
    blockPair(10, 20)
    assert.equal(isBlockedPair(10, 20), true)
    assert.equal(isBlockedPair(20, 10), true)
    assert.equal(isBlockedPair(10, 21), false)
  })

  it('hydrates from db-like rows', () => {
    const before = blockedPairCount()
    hydrateBlocks([
      { blocker_id: 1, blocked_id: 2 },
      { blocker_id: 3, blocked_id: 4 },
    ])
    assert.equal(isBlockedPair(1, 2), true)
    assert.equal(isBlockedPair(3, 4), true)
    assert.ok(blockedPairCount() >= before + 2)
  })
})

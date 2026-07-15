import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, isAdult, validCredentials, verifyPassword, hashToken } from './auth'

describe('auth helpers', () => {
  it('validates credentials', () => {
    assert.equal(validCredentials('a@b.co', 'password1'), true)
    assert.equal(validCredentials('bad', 'password1'), false)
    assert.equal(validCredentials('a@b.co', 'short'), false)
  })

  it('checks adult age', () => {
    assert.equal(isAdult('2000-01-01'), true)
    assert.equal(isAdult('2015-01-01'), false)
  })

  it('hashes and verifies passwords', async () => {
    const stored = await hashPassword('secretpass')
    assert.equal(await verifyPassword('secretpass', stored), true)
    assert.equal(await verifyPassword('wrongpass1', stored), false)
  })

  it('hashes tokens deterministically', () => {
    assert.equal(hashToken('abc'), hashToken('abc'))
    assert.notEqual(hashToken('abc'), hashToken('abd'))
  })
})

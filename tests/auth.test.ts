import { describe, it, expect } from 'vitest'
import { hashPassword, isAdult, validCredentials, verifyPassword, hashToken } from '../server/auth'

describe('auth helpers', () => {
  it('validates credentials', () => {
    expect(validCredentials('a@b.co', 'password1')).toBe(true)
    expect(validCredentials('bad', 'password1')).toBe(false)
    expect(validCredentials('a@b.co', 'short')).toBe(false)
  })

  it('checks adult age', () => {
    expect(isAdult('2000-01-01')).toBe(true)
    expect(isAdult('2015-01-01')).toBe(false)
  })

  it('hashes and verifies passwords', async () => {
    const stored = await hashPassword('secretpass')
    expect(await verifyPassword('secretpass', stored)).toBe(true)
    expect(await verifyPassword('wrongpass1', stored)).toBe(false)
  })

  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})

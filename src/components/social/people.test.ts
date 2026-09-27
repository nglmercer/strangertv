import { describe, expect, it } from 'vitest'
import { userDisplayName } from './people'

describe('userDisplayName', () => {
  it('prefers the profile name, then the handle, then the email part', () => {
    expect(userDisplayName({ email: 'ada@test.io', username: 'ada', displayName: 'Ada L.' })).toBe('Ada L.')
    expect(userDisplayName({ email: 'ada@test.io', username: 'ada' })).toBe('ada')
    expect(userDisplayName({ email: 'ada@test.io', username: null, displayName: null })).toBe('ada')
    expect(userDisplayName({ email: 'ada@test.io' })).toBe('ada')
  })
})

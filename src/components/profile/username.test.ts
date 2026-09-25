import { describe, expect, it } from 'vitest'
import { normalizeUsername, validateUsername } from './username'

describe('normalizeUsername', () => {
  it('trims and lowercases', () => {
    expect(normalizeUsername('  Ada_Love  ')).toBe('ada_love')
  })
})

describe('validateUsername', () => {
  it('accepts the documented shape', () => {
    expect(validateUsername('ada')).toBeNull()
    expect(validateUsername('ada_lovelace99')).toBeNull()
    expect(validateUsername('a'.repeat(20))).toBeNull()
  })

  it('rejects lengths, shapes, and reserved names like the server', () => {
    expect(validateUsername('ab')).toBe('Usernames are 3-20 characters.')
    expect(validateUsername('a'.repeat(21))).toBe('Usernames are 3-20 characters.')
    expect(validateUsername('Ada')).toBe('Usernames use lowercase letters, numbers, and _.')
    expect(validateUsername('ada-love')).toBe('Usernames use lowercase letters, numbers, and _.')
    expect(validateUsername('_ada')).toBe('Usernames start with a letter or number.')
    expect(validateUsername('admin')).toBe('That username is reserved.')
    expect(validateUsername('api')).toBe('That username is reserved.')
    expect(validateUsername('me')).toBe('Usernames are 3-20 characters.')
  })
})

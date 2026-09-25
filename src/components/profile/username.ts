/**
 * Client mirror of the server username rules (`domain::profiles`): pre-flight
 * validation so the rename form fails fast. The server re-validates; these
 * messages intentionally match its wording.
 */

const MIN = 3
const MAX = 20

const RESERVED = [
  'me',
  'admin',
  'api',
  'search',
  'support',
  'settings',
  'profiles',
  'users',
  'auth',
  'login',
  'register',
  'social',
  'u',
]

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Error message for a normalized name, or null when valid. */
export function validateUsername(name: string): string | null {
  if (name.length < MIN || name.length > MAX) return 'Usernames are 3-20 characters.'
  if (!/^[a-z0-9_]+$/.test(name)) return 'Usernames use lowercase letters, numbers, and _.'
  if (!/^[a-z0-9]/.test(name)) return 'Usernames start with a letter or number.'
  if (RESERVED.includes(name)) return 'That username is reserved.'
  return null
}

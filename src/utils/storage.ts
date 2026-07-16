import {
  STORAGE_BOOL,
  STORAGE_FLAG,
  STORAGE_KEYS,
} from '../../shared/constants'

export { STORAGE_KEYS }

export type PublicUser = {
  id: number
  email: string
  birthDate?: string | null
  gender?: string
  country?: string
  language?: string
  interests?: string[]
  emailVerified?: boolean
}

/**
 * Safe localStorage access. Every read/write is wrapped so the app keeps
 * working in private-mode / quota-exceeded / SSR-less edge cases. This is the
 * single place that talks to the `localStorage` global.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode / quota */
  }
}

export function get(key: string): string | null {
  return read(key)
}

export function set(key: string, value: string) {
  write(key, value)
}

export function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Read a JSON-serialized value, returning `fallback` on miss or parse error. */
export function getJSON<T>(key: string, fallback: T): T {
  const raw = read(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Write a JSON-serialized value; non-serializable values are ignored. */
export function setJSON<T>(key: string, value: T) {
  try {
    write(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Boolean flag conventions
// ---------------------------------------------------------------------------

/** '0' / '1' flags (STORAGE_FLAG). */
export function getFlag(key: string): boolean {
  return read(key) === STORAGE_FLAG.on
}

export function setFlag(key: string, on: boolean) {
  write(key, on ? STORAGE_FLAG.on : STORAGE_FLAG.off)
}

/** 'true' / 'false' string flags (STORAGE_BOOL). */
export function getBool(key: string): boolean {
  return read(key) === STORAGE_BOOL.true
}

export function setBool(key: string, on: boolean) {
  write(key, on ? STORAGE_BOOL.true : STORAGE_BOOL.false)
}

// ---------------------------------------------------------------------------
// Auth session (token + user)
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  return read(STORAGE_KEYS.token)
}

export function setSession(token: string, user: PublicUser) {
  write(STORAGE_KEYS.token, token)
  setJSON(STORAGE_KEYS.user, user)
}

export function getStoredUser(): PublicUser | null {
  return getJSON<PublicUser | null>(STORAGE_KEYS.user, null)
}

export function clearSession() {
  remove(STORAGE_KEYS.token)
  remove(STORAGE_KEYS.user)
}

// ---------------------------------------------------------------------------
// Match notification preferences
// ---------------------------------------------------------------------------

export function isMatchSoundEnabled(): boolean {
  return get(STORAGE_KEYS.matchSound) !== STORAGE_FLAG.off
}

export function setMatchSoundEnabled(on: boolean) {
  setFlag(STORAGE_KEYS.matchSound, on)
}

export function isMatchNotifyEnabled(): boolean {
  return getFlag(STORAGE_KEYS.matchNotify)
}

export function setMatchNotifyEnabled(on: boolean) {
  setFlag(STORAGE_KEYS.matchNotify, on)
}

// ---------------------------------------------------------------------------
// Locale
// ---------------------------------------------------------------------------

export function getStoredLocale(): string | null {
  return read(STORAGE_KEYS.locale)
}

export function setStoredLocale(locale: string) {
  write(STORAGE_KEYS.locale, locale)
}

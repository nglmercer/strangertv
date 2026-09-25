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
//
// Browser auth is cookie-primary: the HttpOnly Better Auth session cookie
// (sent with `credentials: include`) owns the session, and the legacy bearer
// is NEVER persisted to localStorage - a persisted credential is readable by
// any script on the page and survives logout-by-cookie-clear.
// The only bearer the client holds is an in-memory fallback for the legacy
// compat path (servers without the Better Auth schema, where no cookie is
// ever issued). It dies with the page and is cleared on logout.
// ---------------------------------------------------------------------------

/** In-memory legacy bearer fallback. Never written to storage. */
let memoryToken: string | null = null

// One-time purge: drop a bearer persisted by an older client so it cannot
// linger in localStorage after this upgrade.
remove(STORAGE_KEYS.token)

/** In-memory legacy bearer, or null when the cookie owns the session. */
export function getToken(): string | null {
  return memoryToken
}

/**
 * Legacy/compat session: hold the bearer in memory only, persist the profile.
 * Used when the server reports `session: 'legacy'` (no cookie was issued).
 */
export function setSession(token: string, user: PublicUser) {
  memoryToken = token
  remove(STORAGE_KEYS.token)
  setJSON(STORAGE_KEYS.user, user)
}

/** Better Auth session: the cookie owns auth, so no bearer is kept at all. */
export function setAuthenticatedUser(user: PublicUser) {
  memoryToken = null
  remove(STORAGE_KEYS.token)
  setJSON(STORAGE_KEYS.user, user)
}

/** Persist the profile without touching the bearer (session refresh path). */
export function setStoredUser(user: PublicUser) {
  setJSON(STORAGE_KEYS.user, user)
}

export function getStoredUser(): PublicUser | null {
  return getJSON<PublicUser | null>(STORAGE_KEYS.user, null)
}

export function clearSession() {
  memoryToken = null
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
// View / layout settings (client-only, never sent to the server)
// ---------------------------------------------------------------------------

export function getUiSettingsRaw(): unknown {
  return getJSON<unknown>(STORAGE_KEYS.uiSettings, null)
}

export function setUiSettingsRaw(value: unknown) {
  setJSON(STORAGE_KEYS.uiSettings, value)
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

import type { Gender, MatchPreferences } from '../shared/types'
import { API_ROUTES, DEFAULT_COUNTRY, DEFAULT_LANGUAGE, HTTP_HEADERS, MIME_TYPE, STORAGE_KEYS, STUN_SERVERS } from '../shared/constants'

const tokenKey = STORAGE_KEYS.token
const userKey = STORAGE_KEYS.user

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

export function getToken() {
  return localStorage.getItem(tokenKey)
}

export function setSession(token: string, user: PublicUser) {
  localStorage.setItem(tokenKey, token)
  localStorage.setItem(userKey, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(tokenKey)
  localStorage.removeItem(userKey)
}

export function getStoredUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(userKey)
    return raw ? (JSON.parse(raw) as PublicUser) : null
  } catch {
    return null
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has(HTTP_HEADERS.contentType) && init?.body) headers.set(HTTP_HEADERS.contentType, MIME_TYPE.json)
  const token = getToken()
  if (token) headers.set(HTTP_HEADERS.authorization, `Bearer ${token}`)
  const res = await fetch(path, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data
}

export const authApi = {
  register: (body: {
    email: string
    password: string
    birthDate: string
    gender?: Gender
    country?: string
    language?: string
    interests?: string[]
  }) =>
    api<{ user: PublicUser; token: string; devVerifyToken?: string }>(API_ROUTES.authRegister, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    api<{ user: PublicUser; token: string }>(API_ROUTES.authLogin, { method: 'POST', body: JSON.stringify(body) }),
  logout: () => api<{ ok: boolean }>(API_ROUTES.authLogout, { method: 'POST' }),
  me: () => api<{ user: PublicUser }>(API_ROUTES.authMe),
  refresh: () => api<{ token: string; user: PublicUser }>(API_ROUTES.authRefresh, { method: 'POST' }),
  savePreferences: (prefs: Partial<MatchPreferences>) =>
    api<{ user: PublicUser }>(API_ROUTES.authPreferences, { method: 'PATCH', body: JSON.stringify(prefs) }),
  requestReset: (email: string) =>
    api<{ ok: boolean; devResetToken?: string }>(API_ROUTES.authPasswordResetRequest, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  confirmReset: (token: string, password: string) =>
    api<{ ok: boolean }>(API_ROUTES.authPasswordResetConfirm, {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  verifyEmail: (token: string) =>
    api<{ ok: boolean }>(API_ROUTES.authVerifyEmail, { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: () => api<{ ok: boolean; devVerifyToken?: string }>(API_ROUTES.authResendVerification, { method: 'POST' }),
  deleteAccount: () => api<{ ok: boolean }>(API_ROUTES.authAccount, { method: 'DELETE' }),
}

export const socialApi = {
  report: (reason: string, detail?: string, roomId?: string) =>
    api<{ ok: boolean }>(API_ROUTES.reports, { method: 'POST', body: JSON.stringify({ reason, detail, roomId }) }),
  block: (blockedId: number) =>
    api<{ ok: boolean }>(API_ROUTES.blocks, { method: 'POST', body: JSON.stringify({ blockedId }) }),
  listBlocks: () =>
    api<{ blocked: Array<{ id: number; email: string | null; createdAt: string | null }> }>(API_ROUTES.blocks),
  unblock: (blockedId: number) => api<{ ok: boolean }>(API_ROUTES.blockById(blockedId), { method: 'DELETE' }),
  rate: (score: number, roomId?: string) =>
    api<{ ok: boolean }>(API_ROUTES.ratings, { method: 'POST', body: JSON.stringify({ score, roomId }) }),
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const data = await api<{ iceServers: RTCIceServer[] }>(API_ROUTES.ice)
    return data.iceServers
  } catch {
    return [{ urls: STUN_SERVERS[0]! }]
  }
}

export async function fetchHealth() {
  try {
    return await api<{ ok: boolean; waiting: number; online: number; version?: string }>(API_ROUTES.health)
  } catch {
    return { ok: false, waiting: 0, online: 0 }
  }
}

export function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  // Prefer same-origin proxy in dev/prod
  return `${proto}://${location.host}/ws`
}

export function loadPrefs(): MatchPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.prefs)
    if (raw) return JSON.parse(raw) as MatchPreferences
  } catch {
    /* ignore */
  }
  return {
    country: DEFAULT_COUNTRY,
    language: DEFAULT_LANGUAGE,
    gender: 'any',
    lookingFor: 'any',
    interests: [],
  }
}

export function savePrefs(prefs: MatchPreferences) {
  localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(prefs))
}

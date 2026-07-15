import type { Gender, MatchPreferences } from '../shared/types'

const tokenKey = 'stranger-token'
const userKey = 'stranger-user'

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
  if (!headers.has('content-type') && init?.body) headers.set('content-type', 'application/json')
  const token = getToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
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
    api<{ user: PublicUser; token: string; devVerifyToken?: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    api<{ user: PublicUser; token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => api<{ user: PublicUser }>('/api/auth/me'),
  refresh: () => api<{ token: string; user: PublicUser }>('/api/auth/refresh', { method: 'POST' }),
  savePreferences: (prefs: Partial<MatchPreferences>) =>
    api<{ user: PublicUser }>('/api/auth/preferences', { method: 'PATCH', body: JSON.stringify(prefs) }),
  requestReset: (email: string) =>
    api<{ ok: boolean; devResetToken?: string }>('/api/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  confirmReset: (token: string, password: string) =>
    api<{ ok: boolean }>('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  verifyEmail: (token: string) =>
    api<{ ok: boolean }>('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: () => api<{ ok: boolean; devVerifyToken?: string }>('/api/auth/resend-verification', { method: 'POST' }),
  deleteAccount: () => api<{ ok: boolean }>('/api/auth/account', { method: 'DELETE' }),
}

export const socialApi = {
  report: (reason: string, detail?: string, roomId?: string) =>
    api<{ ok: boolean }>('/api/reports', { method: 'POST', body: JSON.stringify({ reason, detail, roomId }) }),
  block: (blockedId: number) =>
    api<{ ok: boolean }>('/api/blocks', { method: 'POST', body: JSON.stringify({ blockedId }) }),
  listBlocks: () =>
    api<{ blocked: Array<{ id: number; email: string | null; createdAt: string | null }> }>('/api/blocks'),
  unblock: (blockedId: number) => api<{ ok: boolean }>(`/api/blocks/${blockedId}`, { method: 'DELETE' }),
  rate: (score: number, roomId?: string) =>
    api<{ ok: boolean }>('/api/ratings', { method: 'POST', body: JSON.stringify({ score, roomId }) }),
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const data = await api<{ iceServers: RTCIceServer[] }>('/api/ice')
    return data.iceServers
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }]
  }
}

export async function fetchHealth() {
  try {
    return await api<{ ok: boolean; waiting: number; online: number }>('/api/health')
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
    const raw = localStorage.getItem('stranger-prefs')
    if (raw) return JSON.parse(raw) as MatchPreferences
  } catch {
    /* ignore */
  }
  return {
    country: 'any',
    language: 'any',
    gender: 'any',
    lookingFor: 'any',
    interests: [],
  }
}

export function savePrefs(prefs: MatchPreferences) {
  localStorage.setItem('stranger-prefs', JSON.stringify(prefs))
}

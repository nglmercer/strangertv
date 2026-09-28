import type { Gender, MatchPreferences, Friend, Follow, FollowStateDTO, Invitation, Message, MediaKind, MediaMetaDTO, MediaUploadDTO, Group, GroupMember, GroupMessage, GroupInvite, ProfileDocDTO, ProfileLinkDTO, ProfileSectionDTO, UserFollowsDTO, ActivityEntry, ActivityInstance, ActivityParticipantEntry } from '../shared/types'
import { API_ROUTES, DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE, DEFAULT_MATCH_MODE, DEFAULT_MATCH_POOL, DEFAULT_MATCH_SCOPE, HTTP_HEADERS, MIME_TYPE, STORAGE_KEYS, STUN_SERVERS } from '../shared/constants'
import {
  type PublicUser,
  clearSession,
  getJSON,
  getStoredUser,
  getToken,
  setJSON,
  setAuthenticatedUser,
  setSession,
  setStoredUser,
} from './utils/storage'

export { clearSession, getStoredUser, getToken, setAuthenticatedUser, setSession, setStoredUser }

export type { PublicUser }

type GroupMessageListener = (message: GroupMessage) => void
const groupMessageListeners = new Set<GroupMessageListener>()

export function onGroupMessage(listener: GroupMessageListener): () => void {
  groupMessageListeners.add(listener)
  return () => groupMessageListeners.delete(listener)
}

export function emitGroupMessage(message: GroupMessage) {
  for (const listener of groupMessageListeners) {
    listener(message)
  }
}

type ActivityStateListener = (instanceId: number, userId: number, state: unknown) => void
type ActivityPresenceListener = (instanceId: number, participants: ActivityParticipantEntry[]) => void
type ActivityEndedListener = (instanceId: number) => void
type ActivityLaunchedListener = (instance: ActivityInstance, activity: ActivityEntry) => void

const activityStateListeners = new Set<ActivityStateListener>()
const activityPresenceListeners = new Set<ActivityPresenceListener>()
const activityEndedListeners = new Set<ActivityEndedListener>()
const activityLaunchedListeners = new Set<ActivityLaunchedListener>()

export function onActivityState(listener: ActivityStateListener): () => void {
  activityStateListeners.add(listener)
  return () => activityStateListeners.delete(listener)
}

export function emitActivityState(instanceId: number, userId: number, state: unknown) {
  for (const listener of activityStateListeners) {
    listener(instanceId, userId, state)
  }
}

export function onActivityPresence(listener: ActivityPresenceListener): () => void {
  activityPresenceListeners.add(listener)
  return () => activityPresenceListeners.delete(listener)
}

export function emitActivityPresence(instanceId: number, participants: ActivityParticipantEntry[]) {
  for (const listener of activityPresenceListeners) {
    listener(instanceId, participants)
  }
}

export function onActivityEnded(listener: ActivityEndedListener): () => void {
  activityEndedListeners.add(listener)
  return () => activityEndedListeners.delete(listener)
}

export function emitActivityEnded(instanceId: number) {
  for (const listener of activityEndedListeners) {
    listener(instanceId)
  }
}

export function onActivityLaunched(listener: ActivityLaunchedListener): () => void {
  activityLaunchedListeners.add(listener)
  return () => activityLaunchedListeners.delete(listener)
}

export function emitActivityLaunched(instance: ActivityInstance, activity: ActivityEntry) {
  for (const listener of activityLaunchedListeners) {
    listener(instance, activity)
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has(HTTP_HEADERS.contentType) && init?.body) headers.set(HTTP_HEADERS.contentType, MIME_TYPE.json)
  // Cookie-primary auth: the HttpOnly session cookie (credentials: include)
  // authenticates every request. The Authorization header below carries only
  // the in-memory legacy fallback, present solely on compat sessions.
  const token = getToken()
  if (token) headers.set(HTTP_HEADERS.authorization, `Bearer ${token}`)
  const res = await fetch(path, { ...init, headers, credentials: init?.credentials ?? 'include' })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const error = new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`,
    ) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  return data
}

/** HTTP status of an `api()` failure, or null on network-level errors. */
export function errorStatus(error: unknown): number | null {
  return error instanceof Error ? ((error as Error & { status?: number }).status ?? null) : null
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
    api<{ user: PublicUser; token: string; session?: 'better-auth' | 'legacy'; devVerifyToken?: string }>(API_ROUTES.authRegister, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    api<{ user: PublicUser; token: string; session?: 'better-auth' | 'legacy' }>(API_ROUTES.authLogin, { method: 'POST', body: JSON.stringify(body) }),
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
  /** Top-level navigation, not fetch: the provider redirect must own the tab. */
  startGoogle: () => {
    location.href = API_ROUTES.authOauthGoogle
  },
  /**
   * Finish a Google signup. Google returns no birth date, so the account only
   * exists once the client supplies one.
   */
  completeGoogleSignup: (body: { token: string; birthDate: string }) =>
    api<{ user: PublicUser; session?: 'better-auth' | 'legacy' }>(API_ROUTES.authOauthGoogleComplete, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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

export const friendsApi = {
  list: () => api<{ friends: Friend[] }>(API_ROUTES.friends),
  request: (userId: number) =>
    api<{ ok: boolean }>(API_ROUTES.friendsRequest, { method: 'POST', body: JSON.stringify({ userId }) }),
  accept: (friendId: number) =>
    api<{ ok: boolean }>(API_ROUTES.friendById(friendId, 'accept'), { method: 'PATCH' }),
  decline: (friendId: number) =>
    api<{ ok: boolean }>(API_ROUTES.friendById(friendId, 'decline'), { method: 'PATCH' }),
  remove: (friendId: number) => api<{ ok: boolean }>(API_ROUTES.friendById(friendId), { method: 'DELETE' }),
  search: (email: string) => api<{ user: PublicUser | null }>(`${API_ROUTES.usersSearch}?email=${encodeURIComponent(email)}`),
}

export const followsApi = {
  follow: (userId: number) =>
    api<{ ok: boolean }>(API_ROUTES.follows, { method: 'POST', body: JSON.stringify({ userId }) }),
  unfollow: (userId: number) => api<{ ok: boolean }>(API_ROUTES.followByUser(userId), { method: 'DELETE' }),
  list: () =>
    api<{ followers: Follow[]; following: Follow[] }>(API_ROUTES.follows),
  /** Public follow lists + counts for any profile page. */
  listFor: (userId: number) => api<UserFollowsDTO>(API_ROUTES.userFollows(userId)),
  /** Viewer-relative state for the Follow button. 401 when logged out. */
  state: (userId: number) => api<FollowStateDTO>(API_ROUTES.followStateByUser(userId)),
}

export const invitationsApi = {
  list: () => api<{ invitations: Invitation[] }>(API_ROUTES.invitations),
  send: (userId: number, roomId: string) =>
    api<{ ok: boolean }>(API_ROUTES.invitations, { method: 'POST', body: JSON.stringify({ userId, roomId }) }),
  accept: (id: number) =>
    api<{ ok: boolean }>(API_ROUTES.invitationById(id, 'accept'), { method: 'PATCH' }),
  decline: (id: number) =>
    api<{ ok: boolean }>(API_ROUTES.invitationById(id, 'decline'), { method: 'PATCH' }),
  cancel: (id: number) => api<{ ok: boolean }>(API_ROUTES.invitationById(id), { method: 'DELETE' }),
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

/** Server capabilities the UI branches on. Falls back to "off" when absent. */
export async function fetchPublicConfig() {
  try {
    return await api<{
      googleAuth?: boolean
      turnConfigured?: boolean
      features?: { anonymousMatch?: boolean; qualityTelemetry?: boolean }
    }>(API_ROUTES.configPublic)
  } catch {
    return { googleAuth: false, turnConfigured: false }
  }
}

export function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function loadPrefs(): MatchPreferences {
  const stored = getJSON<Partial<MatchPreferences> | null>(STORAGE_KEYS.prefs, null)
  return {
    country: DEFAULT_COUNTRY,
    language: DEFAULT_LANGUAGE,
    gender: DEFAULT_GENDER,
    lookingFor: DEFAULT_GENDER,
    interests: [],
    allowMatchWithSameUsers: true,
    mode: DEFAULT_MATCH_MODE,
    matchScope: DEFAULT_MATCH_SCOPE,
    matchPool: DEFAULT_MATCH_POOL,
    ...stored,
  }
}

export function savePrefs(prefs: MatchPreferences) {
  setJSON(STORAGE_KEYS.prefs, prefs)
}

export const messagesApi = {
  getConversation: (friendId: number, limit?: number, beforeId?: number) => {
    const params = new URLSearchParams({ friendId: String(friendId) })
    if (limit) params.set('limit', String(limit))
    if (beforeId) params.set('beforeId', String(beforeId))
    return api<{ messages: Message[] }>(`${API_ROUTES.messages}?${params}`)
  },
  send: (friendId: number, text: string) =>
    api<{ message: Message }>(API_ROUTES.messages, {
      method: 'POST',
      body: JSON.stringify({ friendId, text }),
    }),
}

export const groupInvitesApi = {
  list: () => api<{ invites: GroupInvite[] }>(API_ROUTES.groupInvites),
  send: (groupId: number, userId: number) =>
    api<{ invite: GroupInvite }>(API_ROUTES.groupInvites, {
      method: 'POST',
      body: JSON.stringify({ groupId, userId }),
    }),
  accept: (inviteId: number) =>
    api<{ ok: boolean }>(API_ROUTES.groupInviteById(inviteId, 'accept'), { method: 'PATCH' }),
  decline: (inviteId: number) =>
    api<{ ok: boolean }>(API_ROUTES.groupInviteById(inviteId, 'decline'), { method: 'PATCH' }),
}

export const profilesApi = {
  getByUsername: (username: string) => api<ProfileDocDTO>(API_ROUTES.profileByUsername(username)),
  saveMine: (doc: {
    links: Array<Omit<ProfileLinkDTO, 'id'>>
    section: ProfileSectionDTO
    profile?: { displayName: string; bio: string; website: string; avatar?: number | null }
  }) => api<ProfileDocDTO>(API_ROUTES.profilesMe, { method: 'PUT', body: JSON.stringify(doc) }),
  setUsername: (username: string) =>
    api<{ username: string }>(API_ROUTES.usersMeUsername, {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    }),
}

/** Client-side mirrors of the server caps: fail fast with a readable message. */
export const MEDIA_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const MEDIA_MAX_BYTES: Record<MediaKind, number> = {
  avatar: 512 * 1024,
  icon: 256 * 1024,
  group: 512 * 1024,
}

export const mediaApi = {
  list: (kind?: MediaKind) => api<{ media: MediaMetaDTO[] }>(API_ROUTES.mediaMine(kind)),
  upload: (kind: MediaKind, mime: string, data: string) =>
    api<MediaUploadDTO>(API_ROUTES.media, {
      method: 'POST',
      body: JSON.stringify({ kind, mime, data }),
    }),
  remove: (id: number) => api<{ ok: boolean }>(API_ROUTES.mediaById(id), { method: 'DELETE' }),
  /**
   * Validated file upload: MIME + size checked before reading so the server
   * never sees an obvious reject. Resolves an ok/error union, never throws.
   */
  uploadFile: (
    kind: MediaKind,
    file: File,
  ): Promise<{ ok: true; upload: MediaUploadDTO } | { ok: false; error: string }> =>
    new Promise((resolve) => {
      if (!(MEDIA_MIMES as readonly string[]).includes(file.type)) {
        resolve({ ok: false, error: 'PNG, JPEG, or WebP only.' })
        return
      }
      if (file.size > MEDIA_MAX_BYTES[kind]) {
        const kb = Math.round(MEDIA_MAX_BYTES[kind] / 1024)
        resolve({ ok: false, error: `Keep it under ${kb} KB.` })
        return
      }
      const reader = new FileReader()
      reader.onerror = () => resolve({ ok: false, error: 'Could not read that file.' })
      reader.onload = () => {
        const data = typeof reader.result === 'string' ? reader.result : ''
        mediaApi.upload(kind, file.type, data).then(
          (upload) => resolve({ ok: true, upload }),
          (error: unknown) =>
            resolve({ ok: false, error: error instanceof Error ? error.message : 'Upload failed.' }),
        )
      }
      reader.readAsDataURL(file)
    }),
}

export const groupsApi = {
  list: () => api<{ groups: Group[] }>(API_ROUTES.groups),
  create: (name: string, memberIds: number[]) =>
    api<{ group: Group }>(API_ROUTES.groups, {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    }),
  get: (id: number) => api<{ group: Group }>(API_ROUTES.groupById(id)),
  /** Admin-only patch: any subset of name, description, image (id or null). */
  update: (id: number, patch: { name?: string; description?: string; image?: number | null }) =>
    api<{ ok: boolean }>(API_ROUTES.groupById(id), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  getMembers: (id: number) =>
    api<{ members: GroupMember[] }>(API_ROUTES.groupMembers(id)),
  addMembers: (id: number, userIds: number[]) =>
    api<{ members: GroupMember[] }>(API_ROUTES.groupMembers(id), {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
  removeMember: (id: number, userId: number) =>
    api<{ ok: boolean }>(API_ROUTES.groupRemoveMember(id, userId), {
      method: 'DELETE',
    }),
  leave: (id: number) =>
    api<{ ok: boolean }>(API_ROUTES.groupLeave(id), {
      method: 'POST',
    }),
  getMessages: (id: number, limit?: number, beforeId?: number) => {
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    if (beforeId) params.set('beforeId', String(beforeId))
    const query = params.toString()
    return api<{ messages: GroupMessage[] }>(`${API_ROUTES.groupMessages(id)}${query ? `?${query}` : ''}`)
  },
  sendMessage: (id: number, text: string) =>
    api<{ message: GroupMessage }>(API_ROUTES.groupMessages(id), {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
}

/**
 * Host-side activity calls (full session). The launch-code exchange and the
 * scoped identity lookup are intentionally NOT here: the game performs them
 * with `credentials: 'omit'` through the SDK in `src/activities/client.ts`,
 * which keeps the two credential realms visibly separate.
 */
export type EconomyLedgerEntry = {
  delta: number
  reason: string
  refId?: string | null
  note?: string | null
  createdAt: string
}

export type EconomyLeader = {
  userId: number
  username?: string | null
  displayName?: string | null
  balance: number
}

export const economyApi = {
  me: () => api<{ balance: number; recent: EconomyLedgerEntry[] }>(API_ROUTES.economyMe),
  leaderboard: () => api<{ leaders: EconomyLeader[] }>(API_ROUTES.economyLeaderboard),
  claimAd: () =>
    api<{ balance: number; granted: boolean; nextClaimAt: number }>(API_ROUTES.economyAdClaim, {
      method: 'POST',
    }),
  gift: (userId: number, amount: number) =>
    api<{ ok: boolean; balance: number }>(API_ROUTES.economyGift, {
      method: 'POST',
      body: JSON.stringify({ userId, amount }),
    }),
}

export const activitiesApi = {
  list: () => api<{ activities: ActivityEntry[] }>(API_ROUTES.activities),
  launch: (activityId: number, groupId: number) =>
    api<{ instance: ActivityInstance }>(API_ROUTES.activityLaunch(activityId), {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    }),
  instances: (groupId: number) => api<{ instances: ActivityInstance[] }>(API_ROUTES.activityInstances(groupId)),
  show: (id: number) =>
    api<{ instance: ActivityInstance; activity: ActivityEntry | null; participants: ActivityParticipantEntry[] }>(
      API_ROUTES.activityInstanceById(id),
    ),
  /** Returns the single-use launch code the iframe exchanges for its token. */
  join: (id: number) => api<{ code: string }>(API_ROUTES.activityInstanceJoin(id), { method: 'POST' }),
  leave: (id: number) => api<{ ok: boolean; ended: boolean }>(API_ROUTES.activityInstanceLeave(id), { method: 'POST' }),
  end: (id: number) => api<{ ok: boolean }>(API_ROUTES.activityInstanceEnd(id), { method: 'POST' }),
}

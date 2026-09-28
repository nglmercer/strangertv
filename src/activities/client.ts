import { API_ROUTES } from '../../shared/constants'

/**
 * postMessage bridge between the host app (parent window) and an activity
 * game (same-origin iframe). This is the game's entire platform API: it
 * receives a single-use launch code, exchanges it for an instance token over
 * plain fetch, and syncs moves through the host's WebSocket. The game never
 * sees the user's session.
 *
 * Both ends enforce the same two rules and ignore anything else, mirroring
 * how the WS handlers drop malformed frames:
 * - `event.origin` must equal this window's own origin (v1 is same-origin),
 * - `event.source` must be the exact counterpart window.
 */

export const ACTIVITY_MSG = {
  // Game -> host
  ready: 'activity:ready',
  publish: 'activity:publish',
  leave: 'activity:leave',
  // Host -> game
  init: 'activity:init',
  state: 'activity:state',
  presence: 'activity:presence',
  ended: 'activity:ended',
} as const

export type ActivityPresenceUser = {
  userId: number
  name: string
}

type MessageEventLike = {
  origin: string
  source: unknown
  data: unknown
}

type WindowLike = {
  location: { origin: string }
  parent: unknown
  addEventListener: (type: 'message', cb: (e: MessageEventLike) => void) => void
  removeEventListener: (type: 'message', cb: (e: MessageEventLike) => void) => void
}

type PostTarget = {
  postMessage: (msg: unknown, origin: string) => void
}

type FrameLike = {
  contentWindow: unknown
}

function realWindow(): WindowLike {
  return globalThis.window as unknown as WindowLike
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function asInit(data: unknown): { code: string; instanceId: number } | null {
  if (!isRecord(data) || data.type !== ACTIVITY_MSG.init) return null
  if (typeof data.code !== 'string' || data.code === '') return null
  if (typeof data.instanceId !== 'number') return null
  return { code: data.code, instanceId: data.instanceId }
}

function asState(data: unknown): { userId: number; state: unknown } | null {
  if (!isRecord(data) || data.type !== ACTIVITY_MSG.state) return null
  if (typeof data.userId !== 'number') return null
  if (!('state' in data)) return null
  return { userId: data.userId, state: data.state }
}

function asPresence(data: unknown): { participants: ActivityPresenceUser[] } | null {
  if (!isRecord(data) || data.type !== ACTIVITY_MSG.presence) return null
  if (!Array.isArray(data.participants)) return null
  const participants: ActivityPresenceUser[] = []
  for (const p of data.participants) {
    if (!isRecord(p) || typeof p.userId !== 'number' || typeof p.name !== 'string') return null
    participants.push({ userId: p.userId, name: p.name })
  }
  return { participants }
}

function asPublish(data: unknown): { state: unknown } | null {
  if (!isRecord(data) || data.type !== ACTIVITY_MSG.publish) return null
  if (!('state' in data)) return null
  return { state: data.state }
}

function asType(data: unknown, type: string): boolean {
  return isRecord(data) && data.type === type
}

/** Subscribe helper: returns an unsubscribe function. */
function on<T>(set: Set<(v: T) => void>, cb: (v: T) => void): () => void {
  set.add(cb)
  return () => set.delete(cb)
}

// --- game side (runs inside the iframe) -------------------------------------

export type ActivityGuest = {
  onInit: (cb: (init: { code: string; instanceId: number }) => void) => () => void
  onState: (cb: (userId: number, state: unknown) => void) => () => void
  onPresence: (cb: (participants: ActivityPresenceUser[]) => void) => () => void
  onEnded: (cb: () => void) => () => void
  /** Announce load; the host answers with `init` (code + instance id). */
  ready: () => void
  /** Broadcast a move to every participant via the host socket. */
  publish: (state: unknown) => void
  /** Ask the host to leave the instance (and close the game). */
  leave: () => void
  dispose: () => void
}

export function createActivityGuest(env?: { win?: WindowLike; parent?: PostTarget }): ActivityGuest {
  const win = env?.win ?? realWindow()
  const parent = (env?.parent ?? win.parent) as PostTarget
  const origin = win.location.origin
  const inits = new Set<(v: { code: string; instanceId: number }) => void>()
  const states = new Set<(v: { userId: number; state: unknown }) => void>()
  const presences = new Set<(p: ActivityPresenceUser[]) => void>()
  const endeds = new Set<() => void>()

  const listener = (e: MessageEventLike) => {
    if (e.origin !== origin || e.source !== (parent as unknown)) return
    const init = asInit(e.data)
    if (init) {
      inits.forEach((cb) => cb(init))
      return
    }
    const st = asState(e.data)
    if (st) {
      states.forEach((cb) => cb({ userId: st.userId, state: st.state }))
      return
    }
    const pr = asPresence(e.data)
    if (pr) {
      presences.forEach((cb) => cb(pr.participants))
      return
    }
    if (asType(e.data, ACTIVITY_MSG.ended)) endeds.forEach((cb) => cb())
  }
  win.addEventListener('message', listener)

  return {
    onInit: (cb) => on(inits, cb),
    onState: (cb) => on(states, (v: { userId: number; state: unknown }) => cb(v.userId, v.state)),
    onPresence: (cb) => on(presences, cb),
    onEnded: (cb) => {
      endeds.add(cb)
      return () => endeds.delete(cb)
    },
    ready: () => parent.postMessage({ type: ACTIVITY_MSG.ready }, origin),
    publish: (state) => parent.postMessage({ type: ACTIVITY_MSG.publish, state }, origin),
    leave: () => parent.postMessage({ type: ACTIVITY_MSG.leave }, origin),
    dispose: () => win.removeEventListener('message', listener),
  }
}

// --- host side (runs in the parent window) ----------------------------------

export type ActivityHost = {
  onReady: (cb: () => void) => () => void
  onPublish: (cb: (state: unknown) => void) => () => void
  onLeave: (cb: () => void) => () => void
  /** Deliver the launch code; the game exchanges it for its own token. */
  init: (code: string, instanceId: number) => void
  pushState: (userId: number, state: unknown) => void
  pushPresence: (participants: ActivityPresenceUser[]) => void
  pushEnded: () => void
  dispose: () => void
}

export function createActivityHost(
  iframe: FrameLike,
  env?: { win?: WindowLike },
): ActivityHost | null {
  const target = iframe.contentWindow as PostTarget | null
  if (!target) return null
  const win = env?.win ?? realWindow()
  const origin = win.location.origin
  const readys = new Set<() => void>()
  const publishes = new Set<(s: unknown) => void>()
  const leaves = new Set<() => void>()

  const listener = (e: MessageEventLike) => {
    if (e.origin !== origin || e.source !== iframe.contentWindow) return
    if (asType(e.data, ACTIVITY_MSG.ready)) {
      readys.forEach((cb) => cb())
      return
    }
    const pub = asPublish(e.data)
    if (pub) {
      publishes.forEach((cb) => cb(pub.state))
      return
    }
    if (asType(e.data, ACTIVITY_MSG.leave)) leaves.forEach((cb) => cb())
  }
  win.addEventListener('message', listener)

  return {
    onReady: (cb) => {
      readys.add(cb)
      return () => readys.delete(cb)
    },
    onPublish: (cb) => on(publishes, cb),
    onLeave: (cb) => {
      leaves.add(cb)
      return () => leaves.delete(cb)
    },
    init: (code, instanceId) => target.postMessage({ type: ACTIVITY_MSG.init, code, instanceId }, origin),
    pushState: (userId, state) => target.postMessage({ type: ACTIVITY_MSG.state, userId, state }, origin),
    pushPresence: (participants) => target.postMessage({ type: ACTIVITY_MSG.presence, participants }, origin),
    pushEnded: () => target.postMessage({ type: ACTIVITY_MSG.ended }, origin),
    dispose: () => win.removeEventListener('message', listener),
  }
}

// --- game login (called by the game, never the host) ------------------------

export type ActivityMe = {
  instanceId: number
  user: { id: number; username: string | null; displayName: string | null }
}

async function gameFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // credentials: omit is the point — the game authenticates with its instance
  // token alone, and this fetch must work even with no session at all.
  const res = await fetch(path, { ...init, credentials: 'omit' })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const error = new Error((data as { error?: string }).error ?? `Request failed (${res.status})`) as Error & {
      status?: number
    }
    error.status = res.status
    throw error
  }
  return data
}

/** Exchange the host's single-use launch code for the game's instance token. */
export function exchangeLaunchCode(instanceId: number, code: string): Promise<{ token: string; userId: number }> {
  return gameFetch<{ token: string; userId: number }>(API_ROUTES.activityInstanceToken(instanceId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

/** Scoped identity: id plus display names. Nothing else is ever returned. */
export function fetchActivityMe(token: string): Promise<ActivityMe> {
  return gameFetch<ActivityMe>(API_ROUTES.activitiesMe, {
    headers: { authorization: `Bearer ${token}` },
  })
}

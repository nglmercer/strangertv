import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '../../shared/constants'

/**
 * Browser credential storage: the HttpOnly Better Auth cookie owns the
 * session, so the legacy bearer and the ADMIN_KEY must never be persisted to
 * localStorage. They live in module state only (page lifetime).
 */

type User = { id: number; email: string; birthDate: string }

const user: User = { id: 1, email: 'a@example.com', birthDate: '1990-01-01' }

/** Minimal localStorage stand-in installed on globalThis (node has none). */
function installStorageStub(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed))
  const stub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true,
    writable: true,
  })
  return store
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  installStorageStub()
})

describe('legacy bearer storage', () => {
  it('setSession keeps the bearer out of localStorage', async () => {
    const store = installStorageStub()
    const storage = await import('./storage')

    storage.setSession('legacy-bearer', user)

    expect(store.get(STORAGE_KEYS.user)).toContain('a@example.com')
    expect(store.has(STORAGE_KEYS.token)).toBe(false)
    expect(storage.getToken()).toBe('legacy-bearer')
  })

  it('setAuthenticatedUser stores the profile and keeps no bearer', async () => {
    const store = installStorageStub()
    const storage = await import('./storage')

    storage.setSession('legacy-bearer', user)
    storage.setAuthenticatedUser(user)

    expect(storage.getToken()).toBeNull()
    expect(store.get(STORAGE_KEYS.user)).toContain('a@example.com')
    expect(store.has(STORAGE_KEYS.token)).toBe(false)
  })

  it('clearSession wipes the profile and the in-memory bearer', async () => {
    const store = installStorageStub()
    const storage = await import('./storage')

    storage.setSession('legacy-bearer', user)
    storage.clearSession()

    expect(storage.getToken()).toBeNull()
    expect(store.has(STORAGE_KEYS.user)).toBe(false)
    expect(store.has(STORAGE_KEYS.token)).toBe(false)
  })

  it('purges a bearer persisted by an older client on load', async () => {
    const store = installStorageStub({ [STORAGE_KEYS.token]: 'old-persisted' })

    const storage = await import('./storage')

    expect(store.has(STORAGE_KEYS.token)).toBe(false)
    expect(storage.getToken()).toBeNull()
  })
})

describe('admin key storage', () => {
  it('holds the key in memory only and clears it on lock', async () => {
    const store = installStorageStub()
    const admin = await import('./adminSession')

    admin.setAdminKey('secret-key')

    expect(admin.getAdminKey()).toBe('secret-key')
    expect(store.has(STORAGE_KEYS.adminKey)).toBe(false)

    admin.clearAdminKey()

    expect(admin.getAdminKey()).toBeNull()
    expect(store.has(STORAGE_KEYS.adminKey)).toBe(false)
  })

  it('purges a key persisted by an older client on load', async () => {
    const store = installStorageStub({ [STORAGE_KEYS.adminKey]: 'old-persisted' })

    const admin = await import('./adminSession')

    expect(store.has(STORAGE_KEYS.adminKey)).toBe(false)
    expect(admin.getAdminKey()).toBeNull()
  })
})

describe('api client auth transport', () => {
  function mockFetch() {
    const seen: Array<{ headers: Headers; credentials?: string }> = []
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push({ headers: new Headers(init?.headers), credentials: init?.credentials })
      return { ok: true, json: async () => ({ ok: true, waiting: 0, online: 0 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    return seen
  }

  it('sends no Authorization header when the cookie owns the session', async () => {
    installStorageStub()
    const seen = mockFetch()
    const api = await import('../api')

    await api.fetchHealth()

    expect(seen).toHaveLength(1)
    expect(seen[0]!.headers.get('authorization')).toBeNull()
    expect(seen[0]!.credentials).toBe('include')
  })

  it('attaches the in-memory bearer as a legacy fallback only', async () => {
    installStorageStub()
    const seen = mockFetch()
    const api = await import('../api')

    api.setSession('legacy-bearer', user)
    await api.fetchHealth()

    expect(seen).toHaveLength(1)
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer legacy-bearer')
    expect(seen[0]!.credentials).toBe('include')
  })
})

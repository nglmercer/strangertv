import { STORAGE_KEYS } from '../../shared/constants'
import { remove } from './storage'

/**
 * Admin console credential, held in module state only.
 *
 * The ADMIN_KEY is never persisted to localStorage: a persisted key survives
 * "lock" expectations and is readable by any script on the page. It lives
 * only for the page lifetime and is wiped by {@link clearAdminKey} on lock.
 */

// One-time purge: drop a key persisted by an older client so it cannot linger
// in localStorage after this upgrade.
remove(STORAGE_KEYS.adminKey)

let adminKey: string | null = null

export function getAdminKey(): string | null {
  return adminKey
}

export function setAdminKey(key: string) {
  adminKey = key
}

export function clearAdminKey() {
  adminKey = null
  remove(STORAGE_KEYS.adminKey)
}

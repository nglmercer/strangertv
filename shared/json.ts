/**
 * Shared JSON helpers used by both server (auth) and client (storage) code.
 * Kept free of any DOM/`localStorage` references so it is safe to import
 * from the Node server entrypoints.
 */

/** Parse a JSON array of strings with a safe fallback to []. */
export function parseInterests(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Stringify an array of interests, clamped to `max` items. */
export function serializeInterests(interests: string[], max = 10): string {
  return JSON.stringify(interests.slice(0, max))
}

/** Parse arbitrary JSON, returning `fallback` on miss or parse error. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

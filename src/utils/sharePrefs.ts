import type { MatchPreferences } from '../../shared/types'
import { DEFAULT_GENDER } from '../../shared/constants'

/** Encode match prefs as base64-encoded JSON for extensibility (future: tokens, keys, etc.). */
export function encodePrefs(prefs: MatchPreferences): string {
  const payload: Partial<MatchPreferences> = {
    country: prefs.country,
    language: prefs.language,
    gender: prefs.gender,
    lookingFor: prefs.lookingFor,
  }
  return btoa(JSON.stringify(payload))
}

/** Decode base64-encoded JSON prefs. Returns null on malformed input. */
export function decodePrefs(code: string): Partial<MatchPreferences> | null {
  try {
    const json = atob(code)
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Partial<MatchPreferences>
  } catch {
    return null
  }
}

/** Build a shareable URL with encoded prefs. */
export function sharePrefsUrl(prefs: MatchPreferences): string {
  const code = encodePrefs(prefs)
  const url = new URL(location.href)
  url.searchParams.set('prefs', code)
  return url.toString()
}

/** Read and decode ?prefs= from the current URL. Returns null if absent or invalid. */
export function readSharedPrefs(): Partial<MatchPreferences> | null {
  const params = new URLSearchParams(location.search)
  const code = params.get('prefs')
  if (!code) return null
  return decodePrefs(code)
}

/** Apply shared prefs on top of defaults, filling gaps from defaults. */
export function mergePrefs(
  shared: Partial<MatchPreferences>,
  defaults: MatchPreferences,
): MatchPreferences {
  return {
    country: shared.country ?? defaults.country,
    language: shared.language ?? defaults.language,
    gender: shared.gender ?? defaults.gender,
    lookingFor: shared.lookingFor ?? defaults.lookingFor,
    interests: defaults.interests,
    allowMatchWithSameUsers: defaults.allowMatchWithSameUsers,
  }
}

/** Validate that decoded prefs have sane values; returns cleaned prefs or null. */
export function sanitizeSharedPrefs(
  raw: Partial<MatchPreferences>,
): Partial<MatchPreferences> | null {
  const out: Partial<MatchPreferences> = {}
  if (raw.country && raw.country.length <= 8) out.country = raw.country
  if (raw.language && raw.language.length <= 16) out.language = raw.language
  const validGenders = [DEFAULT_GENDER, 'male', 'female', 'other']
  if (raw.lookingFor && validGenders.includes(raw.lookingFor)) out.lookingFor = raw.lookingFor
  if (raw.gender && validGenders.includes(raw.gender)) out.gender = raw.gender
  if (Object.keys(out).length === 0) return null
  return out
}

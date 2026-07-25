import type { Gender, MatchPreferences } from '../../shared/types'
import { DEFAULT_GENDER } from '../../shared/constants'

/** Fields that can be shared via a ?prefs= compact code. */
const SHARE_FIELDS = ['country', 'language', 'lookingFor', 'gender'] as const
type ShareField = (typeof SHARE_FIELDS)[number]

/** Encode match prefs into a compact URL-safe string: "PE-es-female-any". */
export function encodePrefs(prefs: MatchPreferences): string {
  const parts = SHARE_FIELDS.map((f) => {
    const v = prefs[f]
    return typeof v === 'string' ? v.replace(/-/g, '~') : ''
  })
  return parts.join('-')
}

/** Decode a compact pref string back into partial prefs. Returns null on malformed input. */
export function decodePrefs(code: string): Partial<MatchPreferences> | null {
  const parts = code.split('-')
  if (parts.length < SHARE_FIELDS.length) return null
  const out: Partial<MatchPreferences> = {}
  for (let i = 0; i < SHARE_FIELDS.length; i++) {
    const field = SHARE_FIELDS[i]!
    const raw = parts[i]!.replace(/~/g, '-')
    if (!raw) continue
    if (field === 'country') out.country = raw
    else if (field === 'language') out.language = raw
    else if (field === 'lookingFor') out.lookingFor = raw as Gender
    else if (field === 'gender') out.gender = raw as Gender
  }
  return out
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

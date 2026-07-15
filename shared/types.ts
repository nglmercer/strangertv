export type Gender = 'any' | 'male' | 'female' | 'other'
export type Locale = 'en' | 'es' | 'pt'

export type MatchPreferences = {
  country: string
  language: string
  gender: Gender
  lookingFor: Gender
  interests: string[]
}

export type ReportReason =
  | 'nudity'
  | 'harassment'
  | 'hate'
  | 'spam'
  | 'underage'
  | 'violence'
  | 'other'

export type ClientMessage =
  | { type: 'queue:join'; preferences: MatchPreferences; token?: string }
  | { type: 'queue:leave' }
  | { type: 'queue:heartbeat' }
  | { type: 'room:next'; preferences: MatchPreferences; token?: string }
  | { type: 'room:leave' }
  | { type: 'signal'; payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown } }
  | { type: 'chat'; payload: { text: string; time: string } }
  | { type: 'report'; reason: ReportReason; detail?: string }
  | { type: 'block' }
  | {
      type: 'telemetry:quality'
      roomId?: string
      quality: 'connecting' | 'good' | 'poor' | 'failed'
      iceState?: string
      connectionState?: string
    }

export type ServerMessage =
  | { type: 'queue:waiting'; position?: number; online?: number }
  | {
      type: 'room:matched'
      roomId: string
      role: 'offerer' | 'answerer'
      peerCountry?: string
      sharedInterests?: string[]
    }
  | { type: 'room:peer-left'; reason?: string }
  | { type: 'signal'; payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown } }
  | { type: 'chat'; payload: { text: string; time: string } }
  | { type: 'stats'; online: number; waiting: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'report:ack' }
  | { type: 'block:ack' }
  | { type: 'server:draining'; message?: string }

/** Canonical interest tags (display labels live in i18n). */
export const INTERESTS = [
  'music',
  'movies',
  'gaming',
  'sports',
  'travel',
  'tech',
  'art',
  'food',
  'languages',
  'anime',
] as const

/** Country preference codes (display labels live in i18n). */
export const COUNTRY_CODES = [
  'any',
  'PE',
  'US',
  'MX',
  'ES',
  'BR',
  'AR',
  'CO',
  'CL',
  'GB',
  'DE',
  'FR',
  'JP',
] as const

/** @deprecated Use COUNTRY_CODES + i18n countryLabel */
export const COUNTRIES = COUNTRY_CODES.map((code) => [code, code] as const)

/** Match language preference codes (display labels live in i18n). */
export const MATCH_LANGUAGE_CODES = ['any', 'en', 'es', 'pt', 'fr', 'de', 'ja'] as const

/** @deprecated Use MATCH_LANGUAGE_CODES + i18n matchLangLabel */
export const MATCH_LANGUAGES = MATCH_LANGUAGE_CODES.map((code) => [code, code] as const)

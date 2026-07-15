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

export type ServerMessage =
  | { type: 'queue:waiting'; position?: number; online?: number }
  | { type: 'room:matched'; roomId: string; role: 'offerer' | 'answerer'; peerCountry?: string }
  | { type: 'room:peer-left'; reason?: string }
  | { type: 'signal'; payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown } }
  | { type: 'chat'; payload: { text: string; time: string } }
  | { type: 'stats'; online: number; waiting: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'report:ack' }

export const INTERESTS = [
  'music', 'movies', 'gaming', 'sports', 'travel', 'tech', 'art', 'food', 'languages', 'anime',
] as const

export const COUNTRIES = [
  ['any', 'Anywhere'],
  ['PE', 'Peru'],
  ['US', 'United States'],
  ['MX', 'Mexico'],
  ['ES', 'Spain'],
  ['BR', 'Brazil'],
  ['AR', 'Argentina'],
  ['CO', 'Colombia'],
  ['CL', 'Chile'],
  ['GB', 'United Kingdom'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['JP', 'Japan'],
] as const

export const MATCH_LANGUAGES = [
  ['any', 'Any language'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['ja', 'Japanese'],
] as const

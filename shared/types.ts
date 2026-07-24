export type Gender = 'any' | 'male' | 'female' | 'other'
export type Locale = 'en' | 'es' | 'pt'

/** WebRTC matchmaking role assigned to each peer in a room. */
export type Role = 'offerer' | 'answerer'

export type FriendStatus = 'pending' | 'accepted' | 'declined'
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired'
export type RelationshipStatus = 'none' | 'friend' | 'following' | 'follower'

/** Minimal public user profile shared between client and server. */
export type PublicUser = {
  id: number
  email: string
  birthDate?: string
  gender?: Gender
  country?: string
  language?: string
  interests?: string[]
  emailVerified?: boolean
}

export type MatchPreferences = {
  country: string
  language: string
  gender: Gender
  lookingFor: Gender
  interests: string[]
  allowMatchWithSameUsers: boolean
}

export type ReportReason =
  | 'nudity'
  | 'harassment'
  | 'hate'
  | 'spam'
  | 'underage'
  | 'violence'
  | 'other'

export type Friend = {
  id: number
  userAId: number
  userBId: number
  status: FriendStatus
  createdAt: string
  updatedAt: string
  otherUser: PublicUser
}

export type Follow = {
  id: number
  followerId: number
  followedId: number
  createdAt: string
  followedUser: PublicUser
}

export type Invitation = {
  id: number
  inviterId: number
  inviteeId: number
  roomId: string
  status: InvitationStatus
  createdAt: string
  expiresAt: string
  inviterUser: PublicUser
}

export type Message = {
  id: number
  senderId: number
  recipientId: number
  text: string
  createdAt: string
}

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
  | { type: 'friend:request'; userId: number }
  | { type: 'friend:accept'; friendId: number }
  | { type: 'friend:decline'; friendId: number }
  | { type: 'friend:remove'; friendId: number }
  | { type: 'follow'; userId: number }
  | { type: 'unfollow'; userId: number }
  | { type: 'invitation:send'; userId: number; roomId: string }
  | { type: 'invitation:accept'; invitationId: number; roomId: string }
  | { type: 'invitation:decline'; invitationId: number }
  | { type: 'message:send'; friendId: number; text: string }
  | { type: 'message:history'; friendId: number; limit?: number; beforeId?: number }
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
      role: Role
      peerCountry?: string
      peerEmail?: string
      peerUserId?: number
      sharedInterests?: string[]
      relationship?: RelationshipStatus
    }
  | { type: 'room:peer-left'; reason?: string }
  | { type: 'signal'; payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown } }
  | { type: 'chat'; payload: { text: string; time: string } }
  | { type: 'stats'; online: number; waiting: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'report:ack' }
  | { type: 'block:ack' }
  | { type: 'server:draining'; message?: string }
  | { type: 'friend:request'; friendId: number; from: PublicUser }
  | { type: 'friend:accepted'; friendId: number; from: PublicUser }
  | { type: 'friend:declined'; friendId: number }
  | { type: 'friend:removed'; friendId: number }
  | { type: 'friend:list'; friends: Array<{ id: number; user: PublicUser; status: FriendStatus }> }
  | { type: 'follow:confirm'; followed: PublicUser }
  | { type: 'follow:removed'; followedId: number }
  | { type: 'follow:list'; followers: Array<{ id: number; user: PublicUser }>; following: Array<{ id: number; user: PublicUser }> }
  | { type: 'invitation:send'; invitationId: number; roomId: string; inviter: PublicUser }
  | { type: 'invitation:accepted'; invitationId: number; roomId: string }
  | { type: 'invitation:declined'; invitationId: number }
  | { type: 'invitation:list'; invitations: Array<{ id: number; inviter: PublicUser; roomId: string; status: InvitationStatus; expiresAt: string }> }
  | { type: 'message:new'; message: Message }
  | { type: 'message:history'; friendId: number; messages: Message[] }

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

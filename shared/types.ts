/**
 * Client/server contract.
 *
 * The wire types are GENERATED FROM RUST (`rust/src/proto/`) by ts-rs and
 * re-exported here so existing imports keep working. Do not edit them by hand:
 * change the Rust definition and run `cargo test` in `rust/`, which rewrites
 * `shared/generated/`. A Rust-side change that breaks the client then shows up
 * as a `tsc` error rather than a runtime surprise.
 *
 * See docs/rust-migration-plan.md §2.
 */
import type { MatchMode, GroupVisibility, MatchScope } from './constants'

export type { MatchMode, GroupVisibility, MatchScope }

// --- Generated wire contract (rust/src/proto) ------------------------------
export type { Gender } from './generated/Gender'
export type { Locale } from './generated/Locale'
export type { Role } from './generated/Role'
export type { FriendStatus } from './generated/FriendStatus'
export type { InvitationStatus } from './generated/InvitationStatus'
export type { RelationshipStatus } from './generated/RelationshipStatus'
export type { GroupRole } from './generated/GroupRole'
export type { ReportReason } from './generated/ReportReason'
export type { PublicUser } from './generated/PublicUser'
export type { MatchPreferences } from './generated/MatchPreferences'
export type { GroupMatchPeer } from './generated/GroupMatchPeer'
export type { Message } from './generated/Message'
export type { GroupMessage } from './generated/GroupMessage'
export type { ClientMessage } from './generated/ClientMessage'
export type { ServerMessage } from './generated/ServerMessage'

// Re-imported locally because the DTOs below reference them.
import type { FriendStatus } from './generated/FriendStatus'
import type { InvitationStatus } from './generated/InvitationStatus'
import type { GroupRole } from './generated/GroupRole'
import type { PublicUser } from './generated/PublicUser'
import type { GroupMessage } from './generated/GroupMessage'

// --- HTTP response DTOs ----------------------------------------------------
// Not carried by the WebSocket protocol, so not part of the generated contract
// yet; these move to Rust with their routes.

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

export type Group = {
  id: number
  name: string
  createdBy: number
  createdAt: string
  myRole?: GroupRole
  memberCount?: number
  members?: GroupMember[]
  lastMessage?: GroupMessage
  unreadCount?: number
}

export type GroupMember = {
  id: number
  groupId: number
  userId: number
  role: GroupRole
  joinedAt: string
  user: PublicUser
}

export type GroupInvite = {
  id: number
  groupId: number
  inviterId: number
  inviteeId: number
  status: 'pending' | 'accepted' | 'declined'
  createdAt: string
  groupName: string
  inviterUser?: PublicUser
}

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

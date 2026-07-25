import type { Gender, Locale, ReportReason } from './types'

/**
 * Centralized constants for string/value literals that were previously
 * hardcoded inline across server/ and src/. Keeping them here prevents drift
 * between the client and server (and tests), and removes magic values.
 */

// ---------------------------------------------------------------------------
// Local storage keys (client)
// ---------------------------------------------------------------------------
export const STORAGE_KEYS = {
  token: 'stranger-token',
  user: 'stranger-user',
  prefs: 'stranger-prefs',
  autoNext: 'stranger-auto-next',
  matchSound: 'stranger-match-sound',
  matchNotify: 'stranger-match-notify',
  locale: 'stranger-locale',
  birthDate: 'stranger-birth-date',
  adminKey: 'stranger-admin-key',
  profileComplete: 'stranger-profile-complete',
  termsAccepted: 'stranger-terms-accepted',
  setupComplete: 'stranger-setup-complete',
  devicesReady: 'stranger-devices-ready',
  videoDevice: 'stranger-video-device-id',
  audioDevice: 'stranger-audio-device-id',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

// ---------------------------------------------------------------------------
// API route paths (client + server + tests must agree)
// ---------------------------------------------------------------------------
export const API_ROUTES = {
  docs: '/api/v1/docs',
  health: '/api/v1/health',
  healthLive: '/api/v1/health/live',
  healthReady: '/api/v1/health/ready',
  metrics: '/api/v1/metrics',
  metricsPrometheus: '/api/v1/metrics/prometheus',
  configPublic: '/api/v1/config/public',
  ice: '/api/v1/ice',
  authRegister: '/api/v1/auth/register',
  authVerifyEmail: '/api/v1/auth/verify-email',
  authResendVerification: '/api/v1/auth/resend-verification',
  authLogin: '/api/v1/auth/login',
  authLogout: '/api/v1/auth/logout',
  authRefresh: '/api/v1/auth/refresh',
  authMe: '/api/v1/auth/me',
  authPreferences: '/api/v1/auth/preferences',
  authPasswordResetRequest: '/api/v1/auth/password-reset/request',
  authPasswordResetConfirm: '/api/v1/auth/password-reset/confirm',
  authAccount: '/api/v1/auth/account',
  blocks: '/api/v1/blocks',
  blockById: (id: number | string) => `/api/v1/blocks/${id}`,
  reports: '/api/v1/reports',
  ratings: '/api/v1/ratings',
  adminOverview: '/api/v1/admin/overview',
  adminReports: '/api/v1/admin/reports',
  adminReportsCsv: '/api/v1/admin/reports.csv',
  adminReportById: (id: number | string) => `/api/v1/admin/reports/${id}`,
  adminBans: '/api/v1/admin/bans',
  adminUsers: '/api/v1/admin/users',
  adminBan: '/api/v1/admin/ban',
  adminBanById: (id: number | string) => `/api/v1/admin/ban/${id}`,
  // Friends
  friends: '/api/v1/friends',
  friendsRequest: '/api/v1/friends/request',
  friendById: (id: number | string, action?: string) => `/api/v1/friends/${id}${action ? `/${action}` : ''}`,
  usersSearch: '/api/v1/users/search',
  // Follows
  follows: '/api/v1/follows',
  followByUser: (id: number | string) => `/api/v1/follows/${id}`,
  // Invitations
  invitations: '/api/v1/invitations',
  invitationById: (id: number | string, action?: string) => `/api/v1/invitations/${id}${action ? `/${action}` : ''}`,
  // Messages
  messages: '/api/v1/messages',
  // Groups
  groups: '/api/v1/groups',
  groupById: (id: number | string) => `/api/v1/groups/${id}`,
  groupMembers: (id: number | string) => `/api/v1/groups/${id}/members`,
  groupMessages: (id: number | string) => `/api/v1/groups/${id}/messages`,
  groupLeave: (id: number | string) => `/api/v1/groups/${id}/leave`,
  groupRemoveMember: (id: number | string, userId: number | string) => `/api/v1/groups/${id}/members/${userId}`,
  // Group invites
  groupInvites: '/api/v1/group-invites',
  groupInviteById: (id: number | string, action?: string) => `/api/v1/group-invites/${id}${action ? `/${action}` : ''}`,
} as const

export const API_PREFIX = '/api/v1'

export const WS_PATH = '/ws'

/** URL query-parameter names for deep links (email verify / password reset / pref share). */
export const URL_PARAM = {
  reset: 'reset',
  verify: 'verify',
  prefs: 'prefs',
  shareCountry: 'country',
  shareLang: 'lang',
  shareLooking: 'looking',
} as const

export const ADMIN_PATH = '/admin'
export const ADMIN_HASH = '#admin'

// ---------------------------------------------------------------------------
// WebSocket message type discriminators
// ---------------------------------------------------------------------------
export const WS_MESSAGE_TYPE = {
  // client -> server
  queueJoin: 'queue:join',
  queueLeave: 'queue:leave',
  queueHeartbeat: 'queue:heartbeat',
  roomNext: 'room:next',
  roomLeave: 'room:leave',
  signal: 'signal',
  chat: 'chat',
  report: 'report',
  block: 'block',
  telemetryQuality: 'telemetry:quality',
  friendRequest: 'friend:request',
  friendAccept: 'friend:accept',
  friendDecline: 'friend:decline',
  friendRemove: 'friend:remove',
  follow: 'follow',
  unfollow: 'unfollow',
  invitationSend: 'invitation:send',
  invitationAccept: 'invitation:accept',
  invitationDecline: 'invitation:decline',
  messageSend: 'message:send',
  messageHistory: 'message:history',
  // server -> client
  queueWaiting: 'queue:waiting',
  roomMatched: 'room:matched',
  roomPeerLeft: 'room:peer-left',
  stats: 'stats',
  error: 'error',
  reportAck: 'report:ack',
  blockAck: 'block:ack',
  serverDraining: 'server:draining',
  friendAccepted: 'friend:accepted',
  friendDeclined: 'friend:declined',
  friendRemoved: 'friend:removed',
  friendList: 'friend:list',
  followConfirm: 'follow:confirm',
  followRemoved: 'follow:removed',
  followList: 'follow:list',
  invitationAccepted: 'invitation:accepted',
  invitationDeclined: 'invitation:declined',
  invitationList: 'invitation:list',
  messageNew: 'message:new',
  // Groups
  groupMessageSend: 'group:message:send',
  groupMessageNew: 'group:message:new',
  groupMemberJoined: 'group:member:joined',
  groupMemberLeft: 'group:member:left',
  groupInviteSend: 'group:invite:send',
  groupInviteAccept: 'group:invite:accept',
  groupInviteDecline: 'group:invite:decline',
  // Group match
  groupMatchCreate: 'group-match:create',
  groupMatchInvite: 'group-match:invite',
  groupMatchJoin: 'group-match:join',
  groupMatchLeave: 'group-match:leave',
  groupMatchStart: 'group-match:start',
  groupMatchCreated: 'group-match:created',
  groupMatchParticipantJoined: 'group-match:participant-joined',
  groupMatchParticipantLeft: 'group-match:participant-left',
  groupMatchInviteReceived: 'group-match:invite-received',
  groupMatchInviteSent: 'group-match:invite-sent',
  groupMatchMatched: 'group-match:matched',
} as const

export type WsMessageType = (typeof WS_MESSAGE_TYPE)[keyof typeof WS_MESSAGE_TYPE]

// ---------------------------------------------------------------------------
// WebRTC signal payload kinds
// ---------------------------------------------------------------------------
export const SIGNAL_KIND = {
  offer: 'offer',
  answer: 'answer',
  candidate: 'candidate',
} as const

export type SignalKind = (typeof SIGNAL_KIND)[keyof typeof SIGNAL_KIND]

// ---------------------------------------------------------------------------
// Peer-left / leave-room reasons
// ---------------------------------------------------------------------------
export const PEER_LEFT_REASON = {
  blocked: 'blocked',
  reported: 'reported',
  next: 'next',
  leave: 'leave',
  disconnect: 'disconnect',
  requeue: 'requeue',
} as const

export type PeerLeftReason = (typeof PEER_LEFT_REASON)[keyof typeof PEER_LEFT_REASON]

// ---------------------------------------------------------------------------
// Server error codes (ServerMessage.error.code)
// ---------------------------------------------------------------------------
export const SERVER_ERROR_CODE = {
  rateLimit: 'rate_limit',
  banned: 'banned',
  authRequired: 'auth_required',
  badPrefs: 'bad_prefs',
  emailUnverified: 'email_unverified',
  queueTimeout: 'queue_timeout',
} as const

export type ServerErrorCode = (typeof SERVER_ERROR_CODE)[keyof typeof SERVER_ERROR_CODE]

// ---------------------------------------------------------------------------
// Connection quality tiers
// ---------------------------------------------------------------------------
export const QUALITY_TIER = {
  idle: 'idle',
  connecting: 'connecting',
  good: 'good',
  poor: 'poor',
  failed: 'failed',
} as const

export type QualityTier = (typeof QUALITY_TIER)[keyof typeof QUALITY_TIER]

// ---------------------------------------------------------------------------
// WebRTC RTCPeerConnection states
// ---------------------------------------------------------------------------
export const RTC_STATE = {
  new: 'new',
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'disconnected',
  failed: 'failed',
  closed: 'closed',
} as const

export type RtcState = (typeof RTC_STATE)[keyof typeof RTC_STATE]

// ---------------------------------------------------------------------------
// RTCIceCandidatePair states (distinct from RTCPeerConnection states)
// ---------------------------------------------------------------------------
export const ICE_PAIR_STATE = {
  frozen: 'frozen',
  waiting: 'waiting',
  inProgress: 'in-progress',
  succeeded: 'succeeded',
  failed: 'failed',
} as const

// ---------------------------------------------------------------------------
// HTTP status codes
// ---------------------------------------------------------------------------
export const HTTP_STATUS = {
  ok: 200,
  created: 201,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  tooManyRequests: 429,
  internalServerError: 500,
  serviceUnavailable: 503,
} as const

// ---------------------------------------------------------------------------
// WebSocket close codes
// ---------------------------------------------------------------------------
export const WS_CLOSE_CODE = {
  serviceRestart: 1012,
} as const

// ---------------------------------------------------------------------------
// HTTP header names
// ---------------------------------------------------------------------------
export const HTTP_HEADERS = {
  contentType: 'content-type',
  authorization: 'authorization',
  xAdminKey: 'x-admin-key',
  xSessionToken: 'x-session-token',
  xForwardedFor: 'x-forwarded-for',
  xRealIp: 'x-real-ip',
  xRequestId: 'x-request-id',
  xRateLimitLimit: 'x-ratelimit-limit',
  xRateLimitRemaining: 'x-ratelimit-remaining',
  xRateLimitReset: 'x-ratelimit-reset',
  xContentTypeOptions: 'x-content-type-options',
  xFrameOptions: 'x-frame-options',
  referrerPolicy: 'referrer-policy',
  permissionsPolicy: 'permissions-policy',
  strictTransportSecurity: 'strict-transport-security',
  contentSecurityPolicy: 'content-security-policy',
  cacheControl: 'cache-control',
} as const

export const BEARER_PREFIX = 'Bearer '

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
export const MIME_TYPE = {
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  plain: 'text/plain; charset=utf-8',
  prometheus: 'text/plain; version=0.0.4; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  octetStream: 'application/octet-stream',
  javascript: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  webmanifest: 'application/manifest+json',
  woff2: 'font/woff2',
} as const

/** Cache-Control header values. */
export const CACHE_CONTROL = {
  noCache: 'no-cache',
  immutable: 'public, max-age=31536000, immutable',
} as const

// ---------------------------------------------------------------------------
// STUN/TURN servers
// ---------------------------------------------------------------------------
export const STUN_SERVERS: string[] = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
]

// ---------------------------------------------------------------------------
// Enumerable value lists derived from shared union types
// ---------------------------------------------------------------------------
export const LOCALES = ['en', 'es', 'pt'] as const satisfies readonly Locale[]
export const GENDERS = ['any', 'male', 'female', 'other'] as const satisfies readonly Gender[]

/** Individual gender values (for comparisons in display mappings). */
export const GENDER = {
  any: 'any',
  male: 'male',
  female: 'female',
  other: 'other',
} as const
export const REPORT_REASONS = [
  'nudity',
  'harassment',
  'hate',
  'spam',
  'underage',
  'violence',
  'other',
] as const satisfies readonly ReportReason[]

export const DEFAULT_COUNTRY = 'any'
export const DEFAULT_LANGUAGE = 'any'
export const DEFAULT_GENDER = 'any'
export const DEFAULT_LOCALE = 'en'
export const DEFAULT_MATCH_MODE = 'solo'
export const DEFAULT_GROUP_VISIBILITY = 'public'
export const DEFAULT_MATCH_SCOPE = 'all'

// ---------------------------------------------------------------------------
// Matchmaking room roles
// ---------------------------------------------------------------------------
export const ROLE = {
  offerer: 'offerer',
  answerer: 'answerer',
} as const

export type Role = (typeof ROLE)[keyof typeof ROLE]

// ---------------------------------------------------------------------------
// Storage flag convention (boolean preferences stored as '0' / '1' strings)
// ---------------------------------------------------------------------------
export const STORAGE_FLAG = {
  off: '0',
  on: '1',
} as const

/** Boolean preference stored as the literal strings 'true' / 'false'. */
export const STORAGE_BOOL = {
  false: 'false',
  true: 'true',
} as const

// ---------------------------------------------------------------------------
// Database column defaults (keep in sync with server/db.ts schema)
// ---------------------------------------------------------------------------
export const DB_DEFAULTS = {
  gender: 'other',
  country: 'any',
  language: 'en',
  booleanFalse: 0,
} as const

// ---------------------------------------------------------------------------
// Report status (DB column values + filter)
// ---------------------------------------------------------------------------
export const REPORT_STATUS = {
  open: 'open',
  resolved: 'resolved',
  pending: 'pending',
} as const

export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS]

// ---------------------------------------------------------------------------
// Admin report filter statuses
// ---------------------------------------------------------------------------
export const REPORT_STATUS_FILTER = {
  all: 'all',
  open: 'open',
  resolved: 'resolved',
} as const

export type ReportStatusFilter = (typeof REPORT_STATUS_FILTER)[keyof typeof REPORT_STATUS_FILTER]

// ---------------------------------------------------------------------------
// Admin tab ids
// ---------------------------------------------------------------------------
export const ADMIN_TAB = {
  overview: 'overview',
  reports: 'reports',
  bans: 'bans',
  users: 'users',
} as const

export type AdminTab = (typeof ADMIN_TAB)[keyof typeof ADMIN_TAB]

// ---------------------------------------------------------------------------
// Static page ids
// ---------------------------------------------------------------------------
export const PAGE_ID = {
  rules: 'rules',
  safety: 'safety',
  privacy: 'privacy',
  terms: 'terms',
} as const

export type PageId = (typeof PAGE_ID)[keyof typeof PAGE_ID]

// ---------------------------------------------------------------------------
// Preferences modal tab ids
// ---------------------------------------------------------------------------
export const PREFS_TAB = {
  match: 'match',
  devices: 'devices',
  language: 'language',
} as const

export type PrefsTab = (typeof PREFS_TAB)[keyof typeof PREFS_TAB]

// ---------------------------------------------------------------------------
// Feature flag environment variable names
// ---------------------------------------------------------------------------
export const FEATURE_FLAG_ENV = {
  anonymousMatch: 'FEATURE_ANONYMOUS_MATCH',
  guestReports: 'FEATURE_GUEST_REPORTS',
  qualityTelemetry: 'FEATURE_QUALITY_TELEMETRY',
  requireEmailVerified: 'FEATURE_REQUIRE_EMAIL_VERIFIED',
} as const

// ---------------------------------------------------------------------------
// Metric counter names (prevent typos across emitters)
// ---------------------------------------------------------------------------
export const METRIC_NAMES = {
  matchesTotal: 'matches_total',
  queueJoins: 'queue_joins',
  matchWait: 'match_wait',
  wsConnections: 'ws_connections',
  reportsTotal: 'reports_total',
  reportsUnderage: 'reports_underage',
  ratingsTotal: 'ratings_total',
  ratingScore: (score: number | string) => `rating_score_${score}`,
  webrtcQuality: (quality: string) => `webrtc_quality_${quality}`,
  alertsSent: 'alerts_sent',
  bansTotal: 'bans_total',
  blocksTotal: 'blocks_total',
  roomNext: 'room_next',
  signalsRelayed: 'signals_relayed',
  chatsRelayed: 'chats_relayed',
  authRegisterAttempts: 'auth_register_attempts',
  authRegisterOk: 'auth_register_ok',
  authLoginAttempts: 'auth_login_attempts',
  authLoginOk: 'auth_login_ok',
  authRefreshOk: 'auth_refresh_ok',
  passwordResetRequests: 'password_reset_requests',
  passwordResetOk: 'password_reset_ok',
  emailVerified: 'email_verified',
} as const

// ---------------------------------------------------------------------------
// Consent / moderation literals
// ---------------------------------------------------------------------------
export const CONSENT_KIND = {
  termsAge: 'terms_age',
} as const

export const BAN_REASON_DEFAULT = 'moderation'

// ---------------------------------------------------------------------------
// Alert webhook event types
// ---------------------------------------------------------------------------
export const ALERT_TYPE = {
  underageReport: 'underage_report',
  reportSpike: 'report_spike',
} as const

// ---------------------------------------------------------------------------
// Email subjects
// ---------------------------------------------------------------------------
export const EMAIL_SUBJECT = {
  verify: 'Verify your stranger email',
  reset: 'Reset your stranger password',
} as const

// ---------------------------------------------------------------------------
// Timing constants (ms)
// ---------------------------------------------------------------------------
export const TIMING_MS = {
  /** Delay before auto re-queuing / closing a transient UI after peer leaves. */
  requeueDelay: 400,
  /** Interval between client→server WebSocket heartbeats. */
  wsHeartbeat: 12_000,
  /** Threshold for "long wait" in the match queue. */
  longWait: 45_000,
  /** Client health/overview poll interval. */
  healthPoll: 15_000,
  /** Client bootstrap health poll interval. */
  healthPollClient: 20_000,
} as const

// ---------------------------------------------------------------------------
// Admin report CSV column headers
// ---------------------------------------------------------------------------
export const REPORT_CSV_HEADERS = [
  'id',
  'reporter_id',
  'reporter_session',
  'room_id',
  'reason',
  'detail',
  'status',
  'created_at',
] as const

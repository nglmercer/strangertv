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
  docs: '/api/docs',
  health: '/api/health',
  healthLive: '/api/health/live',
  healthReady: '/api/health/ready',
  metrics: '/api/metrics',
  metricsPrometheus: '/api/metrics/prometheus',
  configPublic: '/api/config/public',
  ice: '/api/ice',
  authRegister: '/api/auth/register',
  authVerifyEmail: '/api/auth/verify-email',
  authResendVerification: '/api/auth/resend-verification',
  authLogin: '/api/auth/login',
  authLogout: '/api/auth/logout',
  authRefresh: '/api/auth/refresh',
  authMe: '/api/auth/me',
  authPreferences: '/api/auth/preferences',
  authPasswordResetRequest: '/api/auth/password-reset/request',
  authPasswordResetConfirm: '/api/auth/password-reset/confirm',
  authAccount: '/api/auth/account',
  blocks: '/api/blocks',
  blockById: (id: number | string) => `/api/blocks/${id}`,
  reports: '/api/reports',
  ratings: '/api/ratings',
  adminOverview: '/api/admin/overview',
  adminReports: '/api/admin/reports',
  adminReportsCsv: '/api/admin/reports.csv',
  adminReportById: (id: number | string) => `/api/admin/reports/${id}`,
  adminBans: '/api/admin/bans',
  adminUsers: '/api/admin/users',
  adminBan: '/api/admin/ban',
  adminBanById: (id: number | string) => `/api/admin/ban/${id}`,
} as const

export const WS_PATH = '/ws'

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
  // server -> client
  queueWaiting: 'queue:waiting',
  roomMatched: 'room:matched',
  roomPeerLeft: 'room:peer-left',
  stats: 'stats',
  error: 'error',
  reportAck: 'report:ack',
  blockAck: 'block:ack',
  serverDraining: 'server:draining',
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
  wsConnections: 'ws_connections',
  reportsTotal: 'reports_total',
  reportsUnderage: 'reports_underage',
  ratingScore: (score: number | string) => `rating_score_${score}`,
  webrtcQuality: (quality: string) => `webrtc_quality_${quality}`,
  alertsSent: 'alerts_sent',
  authRegisterOk: 'auth_register_ok',
  authLoginOk: 'auth_login_ok',
} as const

// ---------------------------------------------------------------------------
// Consent / moderation literals
// ---------------------------------------------------------------------------
export const CONSENT_KIND = {
  termsAge: 'terms_age',
} as const

export const BAN_REASON_DEFAULT = 'moderation'

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

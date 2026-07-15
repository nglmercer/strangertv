/** Central env-backed feature flags and runtime config. */

function bool(name: string, fallback = false) {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  return v === '1' || v.toLowerCase() === 'true' || v === 'yes'
}

function num(name: string, fallback: number) {
  const v = Number(process.env[name])
  return Number.isFinite(v) ? v : fallback
}

export const config = {
  port: num('PORT', 8787),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: (process.env.NODE_ENV ?? '') === 'production',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  adminKey: process.env.ADMIN_KEY ?? '',
  metricsPublic: bool('METRICS_PUBLIC', false),
  staticDir: process.env.STATIC_DIR ?? '',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  features: {
    /** Allow anonymous match without login */
    anonymousMatch: bool('FEATURE_ANONYMOUS_MATCH', true),
    /** Accept reports from unauthenticated clients */
    guestReports: bool('FEATURE_GUEST_REPORTS', true),
    /** Server accepts client WebRTC quality samples */
    qualityTelemetry: bool('FEATURE_QUALITY_TELEMETRY', true),
    /** Require verified email for login/match when signed in */
    requireEmailVerified: bool('FEATURE_REQUIRE_EMAIL_VERIFIED', false),
  },
  drainMs: num('SHUTDOWN_DRAIN_MS', 8_000),
}

export type AppConfig = typeof config

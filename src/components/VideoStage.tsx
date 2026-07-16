import type { RefObject } from 'preact'
import { countryLabel, interestLabel, type Messages } from '../i18n'
import type { Quality } from '../types/ui'
import { QUALITY_TIER } from '../../shared/constants'
import { StaticNoise } from './StaticNoise'
import { formatDuration } from '../utils/format'
import type { LinkStats } from '../utils/webrtcQuality'
import { QualityBadge } from './QualityBadge'
import type { PublicUser } from '../api'

export function VideoStage({
  t,
  finding,
  matched,
  status,
  longWait,
  queuePos,
  quality,
  linkStats,
  hasRemote,
  peerCountry,
  callSeconds,
  sharedInterests,
  localVideo,
  remoteVideo,
  hasLocalStream,
  user,
  onPreferences,
  onSettings,
  onAuthClick,
}: {
  t: Messages
  finding: boolean
  matched: boolean
  status: string
  longWait: boolean
  queuePos?: number
  quality: Quality
  linkStats?: LinkStats | null
  hasRemote: boolean
  peerCountry: string
  callSeconds: number
  sharedInterests: string[]
  localVideo: RefObject<HTMLVideoElement>
  remoteVideo: RefObject<HTMLVideoElement>
  hasLocalStream: boolean
  user: PublicUser | null
  onPreferences: () => void
  onSettings: () => void
  onAuthClick: () => void
}) {
  const emptyTitle = finding ? status || t.searchingTitle : t.idleTitle
  const emptyBody = finding
    ? longWait
      ? t.longWait
      : queuePos
        ? `${t.position} #${queuePos}`
        : t.searchingHint
    : t.idleHint

  // Identity + timer only — quality lives in the hover badge (no duplicate text).
  const strangerMeta = [
    t.labelStranger,
    peerCountry ? countryLabel(t, peerCountry) : '',
    matched && callSeconds > 0 ? formatDuration(callSeconds) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section class="stage" aria-label={t.live}>
      <div class="video-grid">
        <article
          class={`video remote ${finding ? 'is-finding' : ''} ${hasRemote ? 'has-stream' : ''} ${matched && !hasRemote ? 'is-connecting' : ''}`}
        >
          <video ref={remoteVideo} autoplay playsinline aria-label={t.labelStranger} />
          {!hasRemote && (
            <div class="stage-empty">
              <StaticNoise opacity={0.42} density={0.5} cellSize={3} />
              <div class="brand-mark" aria-hidden="true">
                <span class="brand-mark-glow" />
                <strong>✦</strong>
                <b>{t.brand}</b>
              </div>
              {finding && (
                <div class="pulse-ring" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}
              <div class="empty">
                <h2>{emptyTitle}</h2>
                <p>{emptyBody}</p>
              </div>
            </div>
          )}
          {strangerMeta && <span class="label">{strangerMeta}</span>}
          {sharedInterests.length > 0 && matched && (
            <div class="interest-badge" aria-label={t.sharedInterests}>
              <div class="chips tight">
                {sharedInterests.map((tag) => (
                  <span class="chip on" key={tag}>
                    {interestLabel(t, tag)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {matched && <QualityBadge quality={quality} stats={linkStats} t={t} />}
        </article>

        <article class={`video local ${hasLocalStream ? 'has-stream' : ''}`}>
          <video ref={localVideo} autoplay playsinline muted aria-label={t.labelYou} />
          {!hasLocalStream && (
            <div class="stage-empty local">
              <div class="local-empty-layout">
                <span class="local-empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2.5" y="5.5" width="13" height="13" rx="2.5" />
                    <path d="M15.5 10l5.5-3v10l-5.5-3" />
                    <line x1="3" y1="3" x2="21" y2="21" stroke-width="1.8" />
                  </svg>
                </span>
                <p class="local-preview-hint">{t.localPreviewHint}</p>
                <div class="local-actions">
                  <button type="button" class="local-action ghost" onClick={onPreferences}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>{t.preferences}</span>
                  </button>
                  {user && (
                    <button type="button" class="local-action ghost" onClick={onSettings}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      <span>{t.settings}</span>
                    </button>
                  )}
                  <button type="button" class="local-action" onClick={onAuthClick}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      {user ? (
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                      ) : (
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
                      )}
                    </svg>
                    <span>{user ? t.signOut : t.signIn}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
          <span class="label">{t.labelYou}</span>
        </article>
      </div>

      {quality === QUALITY_TIER.failed && matched && (
        <p class="stage-error" role="alert">
          {t.connectionFailed}
        </p>
      )}
    </section>
  )
}

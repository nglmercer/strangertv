import type { RefObject } from 'preact'
import { countryLabel, interestLabel, type Messages } from '../i18n'
import type { Quality } from '../types/ui'
import { formatDuration } from '../utils/format'
import type { LinkStats } from '../utils/webrtcQuality'
import { QualityBadge } from './QualityBadge'

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
              <div class="empty">
                <p class="local-preview-hint">{t.localPreviewHint}</p>
              </div>
            </div>
          )}
          <span class="label">{t.labelYou}</span>
        </article>
      </div>

      {quality === 'failed' && matched && (
        <p class="stage-error" role="alert">
          {t.connectionFailed}
        </p>
      )}
    </section>
  )
}

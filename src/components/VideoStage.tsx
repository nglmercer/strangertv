import type { RefObject } from 'preact'
import { countryLabel, interestLabel, type Messages } from '../i18n'
import type { Quality } from '../types/ui'
import { formatDuration } from '../utils/format'

export function VideoStage({
  t,
  finding,
  matched,
  status,
  longWait,
  queuePos,
  quality,
  qualityLabel,
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
  qualityLabel: string
  hasRemote: boolean
  peerCountry: string
  callSeconds: number
  sharedInterests: string[]
  localVideo: RefObject<HTMLVideoElement>
  remoteVideo: RefObject<HTMLVideoElement>
  hasLocalStream: boolean
}) {
  const finderSub = finding
    ? longWait
      ? t.longWait
      : queuePos
        ? `${t.position} #${queuePos}`
        : qualityLabel || t.searchingHint
    : t.readySub

  const emptyTitle = finding ? status || t.searchingTitle : t.idleTitle
  const emptyBody = finding ? t.searchingHint : t.idleHint

  const strangerMeta = [
    t.labelStranger,
    peerCountry ? `${t.peerFrom} ${countryLabel(t, peerCountry)}` : '',
    matched && callSeconds > 0 ? `${t.callTime} ${formatDuration(callSeconds)}` : '',
    qualityLabel,
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
          <span class="label">{strangerMeta}</span>
          {sharedInterests.length > 0 && matched && (
            <div class="interest-badge" aria-label={t.sharedInterests}>
              <small>{t.sharedInterests}</small>
              <div class="chips tight">
                {sharedInterests.map((tag) => (
                  <span class="chip on" key={tag}>
                    {interestLabel(t, tag)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {matched && quality !== 'idle' && (
            <span class={`quality-pill quality-${quality}`} aria-hidden="true">
              {qualityLabel || t.quality.connecting}
            </span>
          )}
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

import type { RefObject } from 'preact'
import type { Messages } from '../i18n'
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
  return (
    <section class="stage">
      <div class={`finder-state ${finding ? 'active' : ''}`} role="status" aria-live="polite">
        <span class="finder-orb">
          <i />
          <i />
          <i />
        </span>
        <strong>{finding ? status : t.ready}</strong>
        <small>
          {finding
            ? longWait
              ? t.longWait
              : queuePos
                ? `${t.position} #${queuePos}`
                : qualityLabel || t.readySub
            : t.readySub}
        </small>
      </div>

      <div class="video-grid">
        <article class={`video remote ${finding ? 'is-finding' : ''} ${hasRemote ? 'has-stream' : ''}`}>
          <video ref={remoteVideo} autoplay playsinline />
          {!hasRemote && (
            <>
              <div class="tv-logo">
                <strong>Ome</strong>
                <b>TV</b>
                <i />
                <i />
              </div>
              <div class="empty">
                <h2>{finding ? status : t.ready}</h2>
                <p>{finding ? t.readySub : t.findStranger}</p>
              </div>
            </>
          )}
          <span class="label">
            Stranger
            {peerCountry ? ` · ${peerCountry}` : ''}
            {matched && callSeconds > 0 ? ` · ${formatDuration(callSeconds)}` : ''}
            {qualityLabel ? ` · ${qualityLabel}` : ''}
          </span>
          {sharedInterests.length > 0 && matched && (
            <div class="interest-badge" aria-label={t.sharedInterests}>
              <small>{t.sharedInterests}</small>
              <div class="chips tight">
                {sharedInterests.map((tag) => (
                  <span class="chip on" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </article>
        <article class="video local">
          <video ref={localVideo} autoplay playsinline muted />
          {!hasLocalStream && <div class="local-empty">{t.previewCam}</div>}
          <span class="label">You</span>
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

import type { RefObject } from 'preact'
import { countryLabel, interestLabel, type Messages } from '../i18n'
import type { Quality } from '../types/ui'
import { QUALITY_TIER } from '../../shared/constants'
import { StaticNoise } from './StaticNoise'
import { formatDuration } from '../utils/format'
import type { LinkStats } from '../utils/webrtcQuality'
import { QualityBadge } from './QualityBadge'
import type { PublicUser } from '../api'
import { BrandMark3D } from './brandmark/BrandMark3D'
import { Icon, icons } from './icons'

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
  peerEmail,
  peerUserId,
  callSeconds,
  sharedInterests,
  localVideo,
  remoteVideo,
  hasLocalStream,
  user,
  onPreferences,
  onSettings,
  onAuthClick,
  onAddFriend,
  onFollow,
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
  peerEmail: string | null
  peerUserId: number | null
  callSeconds: number
  sharedInterests: string[]
  localVideo: RefObject<HTMLVideoElement>
  remoteVideo: RefObject<HTMLVideoElement>
  hasLocalStream: boolean
  user: PublicUser | null
  onPreferences: () => void
  onSettings: () => void
  onAuthClick: () => void
  onAddFriend: () => void
  onFollow: () => void
}) {
  const emptyTitle = finding ? status || t.searchingTitle : t.idleTitle
  const emptyBody = finding
    ? longWait
      ? t.longWait
      : queuePos
        ? `${t.position} #${queuePos}`
        : t.searchingHint
    : t.idleHint

  const strangerName = peerEmail ? peerEmail.split('@')[0] : t.labelStranger
  const strangerMeta = [
    strangerName,
    peerCountry ? countryLabel(t, peerCountry) : '',
    matched && callSeconds > 0 ? formatDuration(callSeconds) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const showPeerActions = matched && peerEmail && user

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
              <BrandMark3D />
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
          {showPeerActions && (
            <div class="peer-actions">
              <button type="button" class="peer-action" onClick={onAddFriend} title={t.addFriend}>
                <Icon d={icons.userPlus} size={14} />
                <span>{t.addFriend}</span>
              </button>
              <button type="button" class="peer-action" onClick={onFollow} title={t.follow}>
                <Icon d={icons.follow} size={14} />
                <span>{t.follow}</span>
              </button>
            </div>
          )}
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
                    <Icon d={icons.settings} size={15} />
                    <span>{t.preferences}</span>
                  </button>
                  {user && (
                    <button type="button" class="local-action ghost" onClick={onSettings}>
                      <Icon d={icons.eye} size={15} />
                      <span>{t.settings}</span>
                    </button>
                  )}
                  <button type="button" class="local-action" onClick={onAuthClick}>
                    <Icon d={icons.signOut} size={15} />
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

import { useEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { countryLabel, interestLabel, type Messages } from '../i18n'
import type { GroupLayout, Quality, SoloLayout } from '../types/ui'
import type { RelationshipStatus } from '../../shared/types'
import { QUALITY_TIER } from '../../shared/constants'
import { StaticNoise } from './StaticNoise'
import { formatDuration } from '../utils/format'
import type { LinkStats } from '../utils/webrtcQuality'
import { QualityBadge } from './QualityBadge'
import type { PublicUser } from '../api'
import { BrandMark3D } from './brandmark/BrandMark3D'
import { Icon, icons } from './icons'
import { SPEECH_ON, useSpeakerFocus } from '../hooks/useSpeakerFocus'

type GroupPeer = { userId: number; email?: string; country?: string; side?: 'local' | 'remote' }

type Tile = {
  id: string
  name: string
  country?: string
  stream: MediaStream | null
  local: boolean
  side: 'local' | 'remote'
}

function StreamVideo({
  stream,
  muted,
  label,
  innerRef,
}: {
  stream: MediaStream | null
  muted: boolean
  label: string
  innerRef?: RefObject<HTMLVideoElement>
}) {
  const ownRef = useRef<HTMLVideoElement>(null)
  const ref = innerRef ?? ownRef
  useEffect(() => {
    const el = ref.current
    if (el && el.srcObject !== stream) el.srcObject = stream
  }, [stream])
  return <video ref={ref} autoplay playsinline muted={muted} aria-label={label} />
}

function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

function GroupTile({
  tile,
  t,
  level,
  speaking,
  compact,
  pinned,
  onSelect,
  localVideo,
}: {
  tile: Tile
  t: Messages
  level: number
  speaking: boolean
  compact: boolean
  pinned: boolean
  onSelect?: () => void
  localVideo?: RefObject<HTMLVideoElement>
}) {
  const interactive = Boolean(onSelect)
  return (
    <article
      class={[
        'video',
        tile.local ? 'local' : 'remote group-peer',
        tile.stream ? 'has-stream' : '',
        speaking ? 'is-speaking' : '',
        compact ? 'tile-compact' : '',
        pinned ? 'is-pinned' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelect}
      onKeyDown={
        interactive
          ? (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect?.()
              }
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? tile.name : undefined}
    >
      <StreamVideo stream={tile.stream} muted={tile.local} label={tile.name} innerRef={tile.local ? localVideo : undefined} />
      {!tile.stream && (
        <div class={`stage-empty ${tile.local ? 'local' : 'peer'}`}>
          {tile.local ? (
            <span class="local-empty-icon" aria-hidden="true">
              <Icon d={icons.videoOff} size={compact ? 24 : 40} />
            </span>
          ) : (
            <span class="peer-avatar" aria-hidden="true">
              {initials(tile.name)}
            </span>
          )}
        </div>
      )}
      <span class="label">{tile.name}</span>
      {tile.country && <span class="peer-country">{countryLabel(t, tile.country)}</span>}
      {speaking && <span class="talk-flag">{t.speaking}</span>}
      <span class="talk-meter" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.round(level * 130))}%` }} />
      </span>
    </article>
  )
}

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
  relationship,
  callSeconds,
  sharedInterests,
  localVideo,
  remoteVideo,
  hasLocalStream,
  localStream,
  user,
  onPreferences,
  onSettings,
  onAuthClick,
  onAddFriend,
  onFollow,
  groupPeers,
  peerStreams,
  localGroupIds,
  soloLayout,
  groupLayout,
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
  relationship: RelationshipStatus
  callSeconds: number
  sharedInterests: string[]
  localVideo: RefObject<HTMLVideoElement>
  remoteVideo: RefObject<HTMLVideoElement>
  hasLocalStream: boolean
  localStream: MediaStream | null
  user: PublicUser | null
  onPreferences: () => void
  onSettings: () => void
  onAuthClick: () => void
  onAddFriend: () => void
  onFollow: () => void
  groupPeers?: GroupPeer[]
  peerStreams: Record<number, MediaStream>
  localGroupIds: number[]
  soloLayout: SoloLayout
  groupLayout: GroupLayout
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

  const showPeerActions = matched && user && Boolean(peerUserId || peerEmail)

  const relationshipLabel =
    relationship === 'friend' ? t.alreadyFriends : relationship === 'following' ? t.following : relationship === 'follower' ? t.follower : null

  const isGroupMatch = matched && Boolean(groupPeers && groupPeers.length > 0)

  const tiles: Tile[] = isGroupMatch
    ? [
        ...groupPeers!.map((peer) => ({
          id: `p${peer.userId}`,
          name: peer.email ? peer.email.split('@')[0] : `User ${peer.userId}`,
          country: peer.country,
          stream: peerStreams[peer.userId] ?? null,
          local: false,
          side: peer.side ?? (localGroupIds.includes(peer.userId) ? 'local' : 'remote'),
        })),
        { id: 'local', name: t.labelYou, stream: localStream, local: true, side: 'local' },
      ]
    : []

  const spotlight = isGroupMatch && groupLayout === 'spotlight'
  const { activeId, levels } = useSpeakerFocus(
    tiles.map((tile) => ({ id: tile.id, stream: tile.stream })),
    isGroupMatch,
  )

  const [pinnedId, setPinnedId] = useState<string | null>(null)
  useEffect(() => {
    if (pinnedId && !tiles.some((tile) => tile.id === pinnedId)) setPinnedId(null)
  }, [tiles.map((tile) => tile.id).join(',')])

  const fallbackId = (tiles.find((tile) => tile.stream && !tile.local) ?? tiles.find((tile) => tile.stream) ?? tiles[0])?.id ?? null
  const mainId = spotlight ? (pinnedId ?? activeId ?? fallbackId) : null
  const mainTile = spotlight ? (tiles.find((tile) => tile.id === mainId) ?? null) : null
  const railTiles = spotlight ? tiles.filter((tile) => tile.id !== mainTile?.id) : []

  return (
    <section class="stage" aria-label={t.live}>
      <div class={`video-grid ${isGroupMatch ? 'group-mode' : `solo-${soloLayout}`}`}>
        {isGroupMatch ? (
          <div class="group-participants">
            {spotlight && mainTile ? (
              <div class="group-spotlight">
                <div class="spotlight-main">
                  <GroupTile
                    tile={mainTile}
                    t={t}
                    level={levels[mainTile.id] ?? 0}
                    speaking={(levels[mainTile.id] ?? 0) >= SPEECH_ON}
                    compact={false}
                    pinned={pinnedId === mainTile.id}
                    onSelect={pinnedId === mainTile.id ? () => setPinnedId(null) : undefined}
                    localVideo={localVideo}
                  />
                </div>
                <div class="spotlight-rail" aria-label={t.participants}>
                  {railTiles.map((tile) => (
                    <GroupTile
                      key={tile.id}
                      tile={tile}
                      t={t}
                      level={levels[tile.id] ?? 0}
                      speaking={(levels[tile.id] ?? 0) >= SPEECH_ON}
                      compact
                      pinned={pinnedId === tile.id}
                      onSelect={() => setPinnedId(pinnedId === tile.id ? null : tile.id)}
                      localVideo={localVideo}
                    />
                  ))}
                </div>
              </div>
            ) : (() => {
              const remoteTiles = tiles.filter((tile) => tile.side === 'remote')
              const localTiles = tiles.filter((tile) => tile.side === 'local')
              const youTile = localTiles.find((tile) => tile.local) ?? localTiles[0]
              const companionTiles = localTiles.filter((tile) => tile.id !== youTile?.id)
              if (remoteTiles.length > 0 && youTile) {
                return (
                  <div class="group-sides">
                    <div class="sides-remote">
                      {remoteTiles.map((tile) => (
                        <GroupTile
                          key={tile.id}
                          tile={tile}
                          t={t}
                          level={levels[tile.id] ?? 0}
                          speaking={(levels[tile.id] ?? 0) >= SPEECH_ON}
                          compact={remoteTiles.length > 2}
                          pinned={false}
                          localVideo={localVideo}
                        />
                      ))}
                    </div>
                    <div class={`sides-local ${companionTiles.length === 0 ? 'no-companions' : ''}`}>
                      <div class="sides-you">
                        <GroupTile
                          tile={youTile}
                          t={t}
                          level={levels[youTile.id] ?? 0}
                          speaking={(levels[youTile.id] ?? 0) >= SPEECH_ON}
                          compact={false}
                          pinned={false}
                          localVideo={localVideo}
                        />
                      </div>
                      {companionTiles.length > 0 && (
                        <div class="sides-companions">
                          {companionTiles.map((tile) => (
                            <GroupTile
                              key={tile.id}
                              tile={tile}
                              t={t}
                              level={levels[tile.id] ?? 0}
                              speaking={(levels[tile.id] ?? 0) >= SPEECH_ON}
                              compact
                              pinned={false}
                              localVideo={localVideo}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              }
              return (
                <div class="group-participants-grid">
                  {tiles.map((tile) => (
                    <GroupTile
                      key={tile.id}
                      tile={tile}
                      t={t}
                      level={levels[tile.id] ?? 0}
                      speaking={(levels[tile.id] ?? 0) >= SPEECH_ON}
                      compact={false}
                      pinned={false}
                      localVideo={localVideo}
                    />
                  ))}
                </div>
              )
            })()}
            {sharedInterests.length > 0 && (
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
          </div>
        ) : (
          <>
            <article
              class={`video remote ${finding ? 'is-finding' : ''} ${hasRemote ? 'has-stream' : ''} ${matched && !hasRemote ? 'is-connecting' : ''}`}
            >
              <video ref={remoteVideo} autoplay playsinline aria-label={t.labelStranger} />
              {!hasRemote && (
                <div class="stage-empty">
                  <StaticNoise opacity={0.55} density={0.6} cellSize={5} />
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
              {relationshipLabel && matched && (
                <span class="relationship-badge">{relationshipLabel}</span>
              )}
              {showPeerActions && (
                <div class="peer-actions">
                  {relationship !== 'friend' && (
                    <button
                      type="button"
                      class="peer-action"
                      onClick={onAddFriend}
                      title={peerUserId ? t.addFriend : peerEmail ? t.peerNotSignedIn : t.addFriend}
                      disabled={!peerUserId && !peerEmail}
                    >
                      <Icon d={icons.userPlus} size={14} />
                      <span>{t.addFriend}</span>
                    </button>
                  )}
                  {relationship !== 'friend' && relationship !== 'following' && (
                    <button
                      type="button"
                      class="peer-action"
                      onClick={onFollow}
                      title={peerUserId ? t.follow : t.peerNotSignedIn}
                      disabled={!peerUserId}
                    >
                      <Icon d={icons.follow} size={14} />
                      <span>{t.follow}</span>
                    </button>
                  )}
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
                      <Icon d={icons.videoOff} size={40} />
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
          </>
        )}
      </div>

      {quality === QUALITY_TIER.failed && matched && (
        <p class="stage-error" role="alert">
          {t.connectionFailed}
        </p>
      )}
    </section>
  )
}

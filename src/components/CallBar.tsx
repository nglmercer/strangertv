import { useEffect, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import type { PublicUser } from '../api'
import type { Quality } from '../types/ui'
import type { RelationshipStatus } from '../../shared/types'
import { QUALITY_TIER } from '../../shared/constants'
import { Icon, icons } from './icons'

type Devices = { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
type MenuKind = 'mic' | 'cam' | 'more' | null

type Props = {
  t: Messages
  finding: boolean
  matched: boolean
  muted: boolean
  cameraOn: boolean
  quality: Quality
  canBlock: boolean
  devices: Devices
  videoId: string
  audioId: string
  user: PublicUser | null
  onMute: () => void
  onCamera: () => void
  onReport: () => void
  onBlock: () => void
  onRetryIce: () => void
  onFullscreen: () => void
  onDeviceChange: (kind: 'video' | 'audio', id: string) => void
  onOpenDeviceSettings: () => void
  onRefreshDevices: () => void
  onPreferences: () => void
  onSettings: () => void
  onAuthClick: () => void
  onAddFriend: () => void
  relationship: RelationshipStatus
}

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
  return d.label || d.deviceId.slice(0, 8) || fallback
}

export function CallBar({
  t,
  finding,
  matched,
  muted,
  cameraOn,
  quality,
  canBlock,
  devices,
  videoId,
  audioId,
  user,
  onMute,
  onCamera,
  onReport,
  onBlock,
  onRetryIce,
  onFullscreen,
  onDeviceChange,
  onOpenDeviceSettings,
  onRefreshDevices,
  onPreferences,
  onSettings,
  onAuthClick,
  onAddFriend,
  relationship,
}: Props) {
  const [menu, setMenu] = useState<MenuKind>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!finding && !matched) return null

  const muteLabel = muted ? t.unmute : t.mute
  const camLabel = cameraOn ? t.camOff : t.camOn

  const openMenu = (kind: Exclude<MenuKind, null>) => {
    setMenu((cur) => {
      const next = cur === kind ? null : kind
      if (next === 'mic' || next === 'cam') onRefreshDevices()
      return next
    })
  }

  const pickDevice = (kind: 'video' | 'audio', id: string) => {
    setMenu(null)
    onDeviceChange(kind, id)
  }

  const openSettings = () => {
    setMenu(null)
    onOpenDeviceSettings()
  }

  return (
    <div ref={rootRef} class="call-bar" role="toolbar" aria-label={t.callControls}>
      <div class={`call-split ${menu === 'mic' ? 'open' : ''}`}>
        <button
          type="button"
          class={`call-btn icon call-split-main ${muted ? 'is-off' : ''}`}
          onClick={onMute}
          aria-pressed={muted}
          aria-label={muteLabel}
          title={muteLabel}
        >
          <Icon d={muted ? icons.micOff : icons.micOn} />
        </button>
        <button
          type="button"
          class={`call-btn icon call-split-caret ${menu === 'mic' ? 'is-active' : ''} ${muted ? 'is-off' : ''}`}
          onClick={() => openMenu('mic')}
          aria-expanded={menu === 'mic'}
          aria-haspopup="menu"
          aria-label={t.micOptions}
          title={t.micOptions}
        >
          <Icon d={icons.chevron} size={16} />
        </button>
        {menu === 'mic' && (
          <div class="call-device-menu" role="menu" aria-label={t.deviceMic}>
            <div class="call-menu-heading">{t.deviceMic}</div>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!audioId}
              class={`call-menu-item ${!audioId ? 'is-selected' : ''}`}
              onClick={() => pickDevice('audio', '')}
            >
              <span class="call-menu-check">{!audioId ? <Icon d={icons.check} size={16} /> : null}</span>
              <span class="call-menu-label">{t.deviceDefault}</span>
            </button>
            {devices.audio.map((d) => {
              const selected = audioId === d.deviceId
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  class={`call-menu-item ${selected ? 'is-selected' : ''}`}
                  key={d.deviceId}
                  onClick={() => pickDevice('audio', d.deviceId)}
                >
                  <span class="call-menu-check">{selected ? <Icon d={icons.check} size={16} /> : null}</span>
                  <span class="call-menu-label">{deviceLabel(d, t.deviceMic)}</span>
                </button>
              )
            })}
            <div class="call-menu-sep" />
            <button type="button" role="menuitem" class="call-menu-item" onClick={openSettings}>
              <Icon d={icons.settings} size={18} />
              <span>{t.mediaChangeDevices}</span>
            </button>
          </div>
        )}
      </div>

      <div class={`call-split ${menu === 'cam' ? 'open' : ''}`}>
        <button
          type="button"
          class={`call-btn icon call-split-main ${!cameraOn ? 'is-off' : ''}`}
          onClick={onCamera}
          aria-pressed={!cameraOn}
          aria-label={camLabel}
          title={camLabel}
        >
          <Icon d={cameraOn ? icons.camOn : icons.camOff} />
        </button>
        <button
          type="button"
          class={`call-btn icon call-split-caret ${menu === 'cam' ? 'is-active' : ''} ${!cameraOn ? 'is-off' : ''}`}
          onClick={() => openMenu('cam')}
          aria-expanded={menu === 'cam'}
          aria-haspopup="menu"
          aria-label={t.camOptions}
          title={t.camOptions}
        >
          <Icon d={icons.chevron} size={16} />
        </button>
        {menu === 'cam' && (
          <div class="call-device-menu" role="menu" aria-label={t.deviceCam}>
            <div class="call-menu-heading">{t.deviceCam}</div>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!videoId}
              class={`call-menu-item ${!videoId ? 'is-selected' : ''}`}
              onClick={() => pickDevice('video', '')}
            >
              <span class="call-menu-check">{!videoId ? <Icon d={icons.check} size={16} /> : null}</span>
              <span class="call-menu-label">{t.deviceDefault}</span>
            </button>
            {devices.video.map((d) => {
              const selected = videoId === d.deviceId
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  class={`call-menu-item ${selected ? 'is-selected' : ''}`}
                  key={d.deviceId}
                  onClick={() => pickDevice('video', d.deviceId)}
                >
                  <span class="call-menu-check">{selected ? <Icon d={icons.check} size={16} /> : null}</span>
                  <span class="call-menu-label">{deviceLabel(d, t.deviceCam)}</span>
                </button>
              )
            })}
            <div class="call-menu-sep" />
            <button type="button" role="menuitem" class="call-menu-item" onClick={openSettings}>
              <Icon d={icons.eye} size={18} />
              <span>{t.previewCam}</span>
            </button>
            <button type="button" role="menuitem" class="call-menu-item" onClick={openSettings}>
              <Icon d={icons.settings} size={18} />
              <span>{t.videoSettings}</span>
            </button>
          </div>
        )}
      </div>

      <div class={`call-more ${menu === 'more' ? 'open' : ''}`}>
        <button
          type="button"
          class={`call-btn icon ${menu === 'more' ? 'is-active' : ''}`}
          onClick={() => openMenu('more')}
          aria-expanded={menu === 'more'}
          aria-haspopup="menu"
          aria-label={t.moreActions}
          title={t.moreActions}
        >
          <Icon d={icons.more} />
        </button>
        {menu === 'more' && (
          <div class="call-more-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              class="call-menu-item"
              disabled={!matched}
              onClick={() => {
                setMenu(null)
                onReport()
              }}
            >
              <Icon d={icons.report} size={18} />
              <span>{t.report}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="call-menu-item danger"
              disabled={!matched || !canBlock}
              title={!canBlock ? t.signInToBlock : undefined}
              onClick={() => {
                setMenu(null)
                onBlock()
              }}
            >
              <Icon d={icons.block} size={18} />
              <span>{canBlock ? t.blockPeer : t.signInToBlock}</span>
            </button>
            {quality === QUALITY_TIER.failed && (
              <button
                type="button"
                role="menuitem"
                class="call-menu-item"
                onClick={() => {
                  setMenu(null)
                  onRetryIce()
                }}
              >
                <Icon d={icons.retry} size={18} />
                <span>{t.retryIce}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              class="call-menu-item"
              onClick={() => {
                setMenu(null)
                onFullscreen()
              }}
            >
              <Icon d={icons.fullscreen} size={18} />
              <span>{t.fullscreen}</span>
            </button>
            <div class="call-menu-sep" />
            {user && relationship !== 'friend' && (
              <button
                type="button"
                role="menuitem"
                class="call-menu-item"
                onClick={() => {
                  setMenu(null)
                  onAddFriend()
                }}
              >
                <Icon d={icons.userPlus} size={18} />
                <span>{t.addFriend}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              class="call-menu-item"
              onClick={() => {
                setMenu(null)
                onPreferences()
              }}
            >
              <Icon d={icons.settings} size={18} />
              <span>{t.preferences}</span>
            </button>
            {user && (
              <button
                type="button"
                role="menuitem"
                class="call-menu-item"
                onClick={() => {
                  setMenu(null)
                  onSettings()
                }}
              >
                <Icon d={icons.eye} size={18} />
                <span>{t.settings}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              class="call-menu-item danger"
              onClick={() => {
                setMenu(null)
                onAuthClick()
              }}
            >
              <Icon d={icons.signOut} size={18} />
              <span>{user ? t.signOut : t.signIn}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

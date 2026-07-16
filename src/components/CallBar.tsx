import { useEffect, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import type { Quality } from '../types/ui'
import { QUALITY_TIER } from '../../shared/constants'

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
  onMute: () => void
  onCamera: () => void
  onNext: () => void
  onStop: () => void
  onReport: () => void
  onBlock: () => void
  onRetryIce: () => void
  onFullscreen: () => void
  onDeviceChange: (kind: 'video' | 'audio', id: string) => void
  onOpenDeviceSettings: () => void
  onRefreshDevices: () => void
}

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  )
}

/** Compact paths for call controls (Material-style simplified). */
const icons = {
  micOn:
    'M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
  micOff:
    'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23A8.9 8.9 0 0 0 19 11zm-5.07.58.07.07V11a3 3 0 0 0-3.07-3l3 3zM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 4.15 2.76l1.53 1.53A6.96 6.96 0 0 1 12 18a7 7 0 0 1-7-7H3a9 9 0 0 0 8 8.94V22h2v-3.06c1.19-.2 2.27-.72 3.16-1.46L19.73 21 21 19.73 4.27 3z',
  camOn:
    'M17 10.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 4v-11l-4 4z',
  camOff:
    'M3.27 2 2 3.27 4.73 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10c.21 0 .42-.04.61-.1L17.73 21 19 19.73 3.27 2zM17 10.5l4 4v-11l-4 4V7a2 2 0 0 0-2-2h-2.73l6.73 6.73V10.5z',
  next: 'M6 18l8.5-6L6 6v12zm9-12v12h2V6h-2z',
  stop: 'M6 6h12v12H6z',
  report:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  block:
    'M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm0 18a8 8 0 0 1-6.32-12.9L16.9 18.32A7.96 7.96 0 0 1 12 20zm6.32-3.1L7.1 5.68A8 8 0 0 1 18.32 16.9z',
  retry:
    'M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5a5 5 0 0 1-8.66 3.5l-1.42 1.42A7 7 0 0 0 19 13c0-3.87-3.13-7-7-7z',
  fullscreen:
    'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  more: 'M6 10a2 2 0 1 0 .001 4.001A2 2 0 0 0 6 10zm6 0a2 2 0 1 0 .001 4.001A2 2 0 0 0 12 10zm6 0a2 2 0 1 0 .001 4.001A2 2 0 0 0 18 10z',
  chevron:
    'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z',
  eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  settings:
    'M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
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
  onMute,
  onCamera,
  onNext,
  onStop,
  onReport,
  onBlock,
  onRetryIce,
  onFullscreen,
  onDeviceChange,
  onOpenDeviceSettings,
  onRefreshDevices,
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

      <button
        type="button"
        class="call-btn icon next-btn"
        onClick={onNext}
        disabled={!finding}
        aria-label={t.next}
        title={t.next}
      >
        <Icon d={icons.next} />
      </button>
      <button
        type="button"
        class="call-btn icon danger"
        onClick={onStop}
        aria-label={t.stop}
        title={t.stop}
      >
        <Icon d={icons.stop} />
      </button>

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
          </div>
        )}
      </div>
    </div>
  )
}

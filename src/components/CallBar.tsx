import { useEffect, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import type { Quality } from '../types/ui'
import { QUALITY_TIER } from '../../shared/constants'

type Props = {
  t: Messages
  finding: boolean
  matched: boolean
  muted: boolean
  cameraOn: boolean
  quality: Quality
  canBlock: boolean
  onMute: () => void
  onCamera: () => void
  onNext: () => void
  onStop: () => void
  onReport: () => void
  onBlock: () => void
  onRetryIce: () => void
  onFullscreen: () => void
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
}

export function CallBar({
  t,
  finding,
  matched,
  muted,
  cameraOn,
  quality,
  canBlock,
  onMute,
  onCamera,
  onNext,
  onStop,
  onReport,
  onBlock,
  onRetryIce,
  onFullscreen,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  if (!finding && !matched) return null

  const muteLabel = muted ? t.unmute : t.mute
  const camLabel = cameraOn ? t.camOff : t.camOn

  return (
    <div ref={rootRef} class="call-bar" role="toolbar" aria-label={t.callControls}>
      <button
        type="button"
        class={`call-btn icon ${muted ? 'is-off' : ''}`}
        onClick={onMute}
        aria-pressed={muted}
        aria-label={muteLabel}
        title={muteLabel}
      >
        <Icon d={muted ? icons.micOff : icons.micOn} />
      </button>
      <button
        type="button"
        class={`call-btn icon ${!cameraOn ? 'is-off' : ''}`}
        onClick={onCamera}
        aria-pressed={!cameraOn}
        aria-label={camLabel}
        title={camLabel}
      >
        <Icon d={cameraOn ? icons.camOn : icons.camOff} />
      </button>
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

      <div class={`call-more ${moreOpen ? 'open' : ''}`}>
        <button
          type="button"
          class={`call-btn icon ${moreOpen ? 'is-active' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          aria-label={t.moreActions}
          title={t.moreActions}
        >
          <Icon d={icons.more} />
        </button>
        {moreOpen && (
          <div class="call-more-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              class="call-menu-item"
              disabled={!matched}
              onClick={() => {
                setMoreOpen(false)
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
                setMoreOpen(false)
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
                  setMoreOpen(false)
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
                setMoreOpen(false)
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

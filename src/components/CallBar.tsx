import type { Messages } from '../i18n'
import type { Quality } from '../types/ui'

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
}: {
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
}) {
  if (!finding && !matched) return null
  return (
    <div class="call-bar" role="toolbar" aria-label="Call controls">
      <button type="button" class="call-btn" onClick={onMute} aria-pressed={muted}>
        {muted ? t.unmute : t.mute}
      </button>
      <button type="button" class="call-btn" onClick={onCamera} aria-pressed={!cameraOn}>
        {cameraOn ? t.camOff : t.camOn}
      </button>
      <button type="button" class="call-btn next-btn" onClick={onNext} disabled={!finding}>
        {t.next}
      </button>
      <button type="button" class="call-btn danger" onClick={onStop}>
        {t.stop}
      </button>
      <button type="button" class="call-btn" onClick={onReport} disabled={!matched}>
        {t.report}
      </button>
      <button
        type="button"
        class="call-btn danger"
        disabled={!matched || !canBlock}
        title={!canBlock ? 'Sign in to block' : undefined}
        onClick={onBlock}
      >
        {t.blockPeer}
      </button>
      {quality === 'failed' && (
        <button type="button" class="call-btn next-btn" onClick={onRetryIce}>
          {t.retryIce}
        </button>
      )}
      <button type="button" class="call-btn" onClick={onFullscreen}>
        {t.fullscreen}
      </button>
    </div>
  )
}

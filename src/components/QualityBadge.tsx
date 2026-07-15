import type { Messages } from '../i18n'
import type { Quality } from '../types/ui'

/** Compact signal icon; details appear on hover / focus. */
export function QualityBadge({
  quality,
  label,
  t,
}: {
  quality: Quality
  label: string
  t: Messages
}) {
  if (quality === 'idle') return null
  const text = label || t.quality.connecting

  return (
    <span
      class={`quality-badge quality-${quality}`}
      tabIndex={0}
      role="status"
      aria-label={text}
      title={text}
    >
      <svg class="quality-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        {/* Signal bars */}
        <rect x="3" y="14" width="3.5" height="7" rx="1" fill="currentColor" opacity={quality === 'failed' ? 0.25 : 0.9} />
        <rect
          x="8.5"
          y="10"
          width="3.5"
          height="11"
          rx="1"
          fill="currentColor"
          opacity={quality === 'connecting' || quality === 'failed' ? 0.3 : 0.95}
        />
        <rect
          x="14"
          y="6"
          width="3.5"
          height="15"
          rx="1"
          fill="currentColor"
          opacity={quality === 'good' ? 1 : quality === 'poor' ? 0.35 : 0.2}
        />
        <rect
          x="19.5"
          y="2"
          width="3.5"
          height="19"
          rx="1"
          fill="currentColor"
          opacity={quality === 'good' ? 1 : 0.18}
        />
        {quality === 'failed' && (
          <path
            d="M4 4l16 16"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          />
        )}
      </svg>
      <span class="quality-tip" role="tooltip">
        {text}
      </span>
    </span>
  )
}

import { formatMessage, type Messages } from '../i18n'
import type { Quality } from '../types/ui'
import type { LinkStats } from '../utils/webrtcQuality'

function tierLabel(t: Messages, quality: Quality): string {
  switch (quality) {
    case 'good':
      return t.quality.good
    case 'poor':
      return t.quality.poor
    case 'failed':
      return t.quality.failed
    case 'connecting':
      return t.quality.connecting
    default:
      return t.quality.connecting
  }
}

function formatDetail(t: Messages, quality: Quality, stats: LinkStats | null | undefined): string {
  const label = tierLabel(t, quality)
  if (quality === 'connecting' || quality === 'failed' || quality === 'idle') {
    return label
  }
  if (!stats || (stats.rttMs == null && stats.lossPct == null && stats.bitrateKbps == null)) {
    return `${label} · ${t.quality.measuring}`
  }
  const rtt = stats.rttMs != null ? `${stats.rttMs}ms` : t.quality.na
  const loss = stats.lossPct != null ? `${stats.lossPct.toFixed(1)}%` : t.quality.na
  const bitrate = stats.bitrateKbps != null ? `${stats.bitrateKbps} kbps` : t.quality.na
  return formatMessage(t.quality.detail, { label, rtt, loss, bitrate })
}

/** Compact signal icon from live WebRTC getStats(); details on hover/focus. */
export function QualityBadge({
  quality,
  stats,
  t,
}: {
  quality: Quality
  stats?: LinkStats | null
  t: Messages
}) {
  if (quality === 'idle') return null
  const text = formatDetail(t, quality, stats)

  return (
    <span
      class={`quality-badge quality-${quality}`}
      tabIndex={0}
      role="status"
      aria-label={text}
      title={text}
    >
      <svg class="quality-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
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
          <path d="M4 4l16 16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        )}
      </svg>
      <span class="quality-tip" role="tooltip">
        {text}
      </span>
    </span>
  )
}

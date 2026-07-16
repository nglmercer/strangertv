import type { Quality } from '../types/ui'
import { QUALITY_TIER, RTC_STATE } from '../../shared/constants'

/** Live link metrics from RTCPeerConnection.getStats() (not mocked). */
export type LinkStats = {
  rttMs: number | null
  /** Packet loss % over the last sample window (0–100). */
  lossPct: number | null
  /** Inbound video bitrate kbps over the last sample window. */
  bitrateKbps: number | null
  jitterMs: number | null
}

export type QualitySnapshot = {
  quality: Quality
  stats: LinkStats
}

type DeltaSeed = {
  packetsReceived: number
  packetsLost: number
  bytesReceived: number
  at: number
}

/**
 * Read RTT / loss / bitrate from WebRTC stats.
 * Uses selected ICE candidate pair + inbound video RTP when available.
 */
export async function readLinkStats(
  pc: RTCPeerConnection,
  prev: DeltaSeed | null,
): Promise<{ stats: LinkStats; seed: DeltaSeed | null }> {
  const report = await pc.getStats()
  let rttMs: number | null = null
  let jitterMs: number | null = null
  let packetsReceived = 0
  let packetsLost = 0
  let bytesReceived = 0
  let hasRtp = false

  report.forEach((stat) => {
    if (stat.type === 'candidate-pair' && (stat as RTCIceCandidatePairStats).state === RTC_STATE.succeeded) {
      const pair = stat as RTCIceCandidatePairStats & { currentRoundTripTime?: number }
      // Prefer nominated / selected pair
      const selected =
        (pair as { selected?: boolean }).selected === true ||
        pair.nominated === true
      const rtt = pair.currentRoundTripTime
      if (typeof rtt === 'number' && (selected || rttMs == null)) {
        rttMs = Math.round(rtt * 1000)
      }
    }
    if (stat.type === 'inbound-rtp') {
      const rtp = stat as RTCInboundRtpStreamStats
      // Prefer video; fall back to any media
      if (rtp.kind === 'video' || (!hasRtp && (rtp.kind === 'audio' || rtp.kind == null))) {
        if (rtp.kind === 'video') hasRtp = true
        packetsReceived = rtp.packetsReceived ?? 0
        packetsLost = rtp.packetsLost ?? 0
        bytesReceived = rtp.bytesReceived ?? 0
        if (typeof rtp.jitter === 'number') jitterMs = Math.round(rtp.jitter * 1000)
      }
    }
  })

  const now = performance.now()
  let lossPct: number | null = null
  let bitrateKbps: number | null = null
  let seed: DeltaSeed | null = {
    packetsReceived,
    packetsLost,
    bytesReceived,
    at: now,
  }

  if (prev && now > prev.at) {
    const dRecv = Math.max(0, packetsReceived - prev.packetsReceived)
    const dLost = Math.max(0, packetsLost - prev.packetsLost)
    const total = dRecv + dLost
    if (total > 0) lossPct = Math.min(100, (dLost / total) * 100)
    const dtSec = (now - prev.at) / 1000
    if (dtSec > 0.2) {
      const dBytes = Math.max(0, bytesReceived - prev.bytesReceived)
      bitrateKbps = Math.round((dBytes * 8) / dtSec / 1000)
    }
  }

  // First sample: still report cumulative loss if any packets exist
  if (lossPct == null && packetsReceived + packetsLost > 0) {
    lossPct = Math.min(100, (packetsLost / (packetsReceived + packetsLost)) * 100)
  }

  return {
    stats: { rttMs, lossPct, bitrateKbps, jitterMs },
    seed,
  }
}

/** Map connection state + link metrics → UI quality tier. */
export function qualityFromLink(
  connectionState: RTCPeerConnectionState,
  stats: LinkStats,
): Quality {
  if (connectionState === RTC_STATE.failed || connectionState === RTC_STATE.closed) return QUALITY_TIER.failed
  if (connectionState === RTC_STATE.new || connectionState === RTC_STATE.connecting) return QUALITY_TIER.connecting
  if (connectionState === RTC_STATE.disconnected) return QUALITY_TIER.poor

  // connected
  const rtt = stats.rttMs
  const loss = stats.lossPct
  if (rtt != null && rtt >= 450) return QUALITY_TIER.poor
  if (loss != null && loss >= 4) return QUALITY_TIER.poor
  if (rtt != null && rtt >= 280 && loss != null && loss >= 1.5) return QUALITY_TIER.poor
  // Very low bitrate with loss often means stalled video
  if (stats.bitrateKbps != null && stats.bitrateKbps < 40 && loss != null && loss >= 2) return QUALITY_TIER.poor
  return QUALITY_TIER.good
}

export const emptyLinkStats: LinkStats = {
  rttMs: null,
  lossPct: null,
  bitrateKbps: null,
  jitterMs: null,
}

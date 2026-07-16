import { useCallback, useRef, useState } from 'preact/hooks'
import { fetchIceServers } from '../api'
import type { Quality } from '../types/ui'
import { QUALITY_TIER, RTC_STATE, SignalKind } from '../../shared/constants'
import {
  emptyLinkStats,
  qualityFromLink,
  readLinkStats,
  type LinkStats,
} from '../utils/webrtcQuality'

type SignalPayload = { kind: SignalKind; data: unknown }

const STATS_INTERVAL_MS = 2000

export function useWebRTC(onSignal: (payload: SignalPayload) => void) {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const remoteReady = useRef(false)
  const statsTimer = useRef<number | null>(null)
  const statsSeed = useRef<{
    packetsReceived: number
    packetsLost: number
    bytesReceived: number
    at: number
  } | null>(null)
  const [quality, setQuality] = useState<Quality>('idle')
  const [linkStats, setLinkStats] = useState<LinkStats>(emptyLinkStats)
  const [hasRemote, setHasRemote] = useState(false)

  const stopStatsLoop = useCallback(() => {
    if (statsTimer.current != null) {
      window.clearInterval(statsTimer.current)
      statsTimer.current = null
    }
    statsSeed.current = null
  }, [])

  const sampleStats = useCallback(async (pc: RTCPeerConnection) => {
    const state = pc.connectionState
    if (state === 'closed' || state === 'failed') return
    try {
      const { stats, seed } = await readLinkStats(pc, statsSeed.current)
      statsSeed.current = seed
      setLinkStats(stats)
      // Re-read state after async getStats
      setQuality(qualityFromLink(pc.connectionState, stats))
    } catch {
      /* getStats can throw if pc is closing */
    }
  }, [])

  const startStatsLoop = useCallback(
    (pc: RTCPeerConnection) => {
      stopStatsLoop()
      void sampleStats(pc)
      statsTimer.current = window.setInterval(() => {
        if (pcRef.current !== pc) {
          stopStatsLoop()
          return
        }
        void sampleStats(pc)
      }, STATS_INTERVAL_MS)
    },
    [sampleStats, stopStatsLoop],
  )

  const clear = useCallback(() => {
    stopStatsLoop()
    pcRef.current?.close()
    pcRef.current = null
    pendingCandidates.current = []
    remoteReady.current = false
    setHasRemote(false)
    setQuality('idle')
    setLinkStats(emptyLinkStats)
  }, [stopStatsLoop])

  const flushCandidates = async (pc: RTCPeerConnection) => {
    for (const c of pendingCandidates.current) {
      try {
        await pc.addIceCandidate(c)
      } catch {
        /* ignore bad candidate */
      }
    }
    pendingCandidates.current = []
  }

  const wirePcEvents = useCallback(
    (pc: RTCPeerConnection, asOfferer: boolean, remoteVideo: HTMLVideoElement | null) => {
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          onSignal({ kind: SIGNAL_KIND.candidate, data: event.candidate.toJSON() })
        }
      }

      pc.ontrack = (event) => {
        if (remoteVideo) {
          remoteVideo.srcObject = event.streams[0] ?? null
        }
        setHasRemote(true)
      }

      const applyState = () => {
        const state = pc.connectionState
        if (state === 'connected') {
          // Coarse until first getStats sample
          setQuality((q) => (q === 'idle' || q === 'connecting' || q === 'failed' ? 'connecting' : q))
          startStatsLoop(pc)
        } else if (state === 'connecting' || state === 'new') {
          setQuality('connecting')
        } else if (state === 'disconnected') {
          setQuality('poor')
        } else if (state === 'failed' || state === 'closed') {
          setQuality('failed')
          stopStatsLoop()
        }
      }

      pc.onconnectionstatechange = applyState

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          setQuality('failed')
          void (async () => {
            try {
              if (pc.restartIce) pc.restartIce()
              if (asOfferer) {
                const offer = await pc.createOffer({ iceRestart: true })
                await pc.setLocalDescription(offer)
                onSignal({ kind: SIGNAL_KIND.offer, data: offer })
              }
            } catch {
              /* ignore */
            }
          })()
        }
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          startStatsLoop(pc)
        }
      }
    },
    [onSignal, startStatsLoop, stopStatsLoop],
  )

  const createPeer = useCallback(
    async (stream: MediaStream, remoteVideo: HTMLVideoElement | null, asOfferer: boolean) => {
      clear()
      setQuality('connecting')
      const iceServers = await fetchIceServers()
      const pc = new RTCPeerConnection({ iceServers })
      pcRef.current = pc

      stream.getTracks().forEach((track) => pc.addTrack(track, stream))
      wirePcEvents(pc, asOfferer, remoteVideo)

      if (asOfferer) {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        onSignal({ kind: SIGNAL_KIND.offer, data: offer })
      }

      return pc
    },
    [clear, onSignal, wirePcEvents],
  )

  const handleSignal = useCallback(
    async (payload: SignalPayload, stream: MediaStream | null, remoteVideo: HTMLVideoElement | null) => {
      if (payload.kind === SIGNAL_KIND.offer) {
        let pc = pcRef.current
        if (!pc) {
          if (!stream) return
          pc = await createPeer(stream, remoteVideo, false)
        }
        await pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
        remoteReady.current = true
        await flushCandidates(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        onSignal({ kind: SIGNAL_KIND.answer, data: answer })
        return
      }

      if (payload.kind === SIGNAL_KIND.answer) {
        const pc = pcRef.current
        if (!pc) return
        await pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
        remoteReady.current = true
        await flushCandidates(pc)
        return
      }

      if (payload.kind === SIGNAL_KIND.candidate) {
        const candidate = payload.data as RTCIceCandidateInit
        const pc = pcRef.current
        if (!pc || !remoteReady.current) {
          pendingCandidates.current.push(candidate)
          return
        }
        try {
          await pc.addIceCandidate(candidate)
        } catch {
          /* ignore */
        }
      }
    },
    [createPeer, onSignal],
  )

  const replaceTracks = useCallback((stream: MediaStream) => {
    const pc = pcRef.current
    if (!pc) return
    const senders = pc.getSenders()
    for (const track of stream.getTracks()) {
      const sender = senders.find((s) => s.track?.kind === track.kind)
      if (sender) void sender.replaceTrack(track)
    }
  }, [])

  const restartIce = useCallback(async () => {
    const pc = pcRef.current
    if (!pc) return
    try {
      setQuality('connecting')
      if (pc.restartIce) pc.restartIce()
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      onSignal({ kind: 'offer', data: offer })
    } catch {
      /* ignore */
    }
  }, [onSignal])

  return {
    pcRef,
    createPeer,
    handleSignal,
    clear,
    quality,
    linkStats,
    hasRemote,
    replaceTracks,
    restartIce,
  }
}

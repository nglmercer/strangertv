import { useCallback, useRef, useState } from 'preact/hooks'
import { fetchIceServers } from '../api'
import type { Quality } from '../types/ui'
import { QUALITY_TIER, RTC_STATE, SIGNAL_KIND, SignalKind } from '../../shared/constants'
import type { Role } from '../../shared/constants'
import {
  emptyLinkStats,
  qualityFromLink,
  readLinkStats,
  type LinkStats,
} from '../utils/webrtcQuality'

type SignalPayload = { kind: SignalKind; data: unknown }

type PeerConnection = {
  pc: RTCPeerConnection
  userId: number
  ready: boolean
  pendingCandidates: RTCIceCandidateInit[]
  statsTimer: number | null
  statsSeed: { packetsReceived: number; packetsLost: number; bytesReceived: number; at: number } | null
}

const STATS_INTERVAL_MS = 2000

export function useWebRTC(onSignal: (payload: SignalPayload, targetUserId?: number) => void) {
  const soloPcRef = useRef<RTCPeerConnection | null>(null)
  const soloPending = useRef<RTCIceCandidateInit[]>([])
  const soloRemoteReady = useRef(false)
  const peersRef = useRef<Map<number, PeerConnection>>(new Map())
  const [quality, setQuality] = useState<Quality>('idle')
  const [linkStats, setLinkStats] = useState<LinkStats>(emptyLinkStats)
  const [hasRemote, setHasRemote] = useState(false)

  const stopStatsLoop = useCallback((peer: PeerConnection) => {
    if (peer.statsTimer != null) {
      window.clearInterval(peer.statsTimer)
      peer.statsTimer = null
    }
    peer.statsSeed = null
  }, [])

  const sampleStats = useCallback(async (peer: PeerConnection) => {
    const state = peer.pc.connectionState
    if (state === RTC_STATE.closed || state === RTC_STATE.failed) return
    try {
      const { stats, seed } = await readLinkStats(peer.pc, peer.statsSeed)
      peer.statsSeed = seed
      setLinkStats(stats)
      setQuality(qualityFromLink(peer.pc.connectionState, stats))
    } catch {
      /* getStats can throw if pc is closing */
    }
  }, [])

  const startStatsLoop = useCallback(
    (peer: PeerConnection) => {
      stopStatsLoop(peer)
      void sampleStats(peer)
      peer.statsTimer = window.setInterval(() => {
        if (!peersRef.current.has(peer.userId)) {
          stopStatsLoop(peer)
          return
        }
        void sampleStats(peer)
      }, STATS_INTERVAL_MS)
    },
    [sampleStats, stopStatsLoop],
  )

  const flushCandidates = async (peer: PeerConnection) => {
    for (const c of peer.pendingCandidates) {
      try {
        await peer.pc.addIceCandidate(c)
      } catch {
        /* ignore */
      }
    }
    peer.pendingCandidates = []
  }

  const wirePcEvents = useCallback(
    (peer: PeerConnection, asOfferer: boolean, remoteVideo: HTMLVideoElement | null) => {
      peer.pc.onicecandidate = (event) => {
        if (event.candidate) {
          onSignal({ kind: SIGNAL_KIND.candidate, data: event.candidate.toJSON() }, peer.userId)
        }
      }

      peer.pc.ontrack = (event) => {
        if (remoteVideo) {
          remoteVideo.srcObject = event.streams[0] ?? null
        }
        setHasRemote(true)
      }

      const applyState = () => {
        const state = peer.pc.connectionState
        if (state === RTC_STATE.connected) {
          setQuality((q) =>
            q === QUALITY_TIER.idle || q === QUALITY_TIER.connecting || q === QUALITY_TIER.failed
              ? QUALITY_TIER.connecting
              : q,
          )
          startStatsLoop(peer)
        } else if (state === RTC_STATE.connecting || state === RTC_STATE.new) {
          setQuality(QUALITY_TIER.connecting)
        } else if (state === RTC_STATE.disconnected) {
          setQuality(QUALITY_TIER.poor)
        } else if (state === RTC_STATE.failed || state === RTC_STATE.closed) {
          setQuality(QUALITY_TIER.failed)
          stopStatsLoop(peer)
        }
      }

      peer.pc.onconnectionstatechange = applyState

      peer.pc.oniceconnectionstatechange = () => {
        if (peer.pc.iceConnectionState === RTC_STATE.failed) {
          setQuality('failed')
          void (async () => {
            try {
              if (peer.pc.restartIce) peer.pc.restartIce()
              if (asOfferer) {
                const offer = await peer.pc.createOffer({ iceRestart: true })
                await peer.pc.setLocalDescription(offer)
                onSignal({ kind: SIGNAL_KIND.offer, data: offer }, peer.userId)
              }
            } catch {
              /* ignore */
            }
          })()
        }
        if (peer.pc.iceConnectionState === 'connected' || peer.pc.iceConnectionState === 'completed') {
          startStatsLoop(peer)
        }
      }
    },
    [onSignal, startStatsLoop, stopStatsLoop],
  )

  const clear = useCallback(() => {
    const peers = peersRef.current
    for (const [id, peer] of peers) {
      stopStatsLoop(peer)
      peer.pc.close()
    }
    peersRef.current = new Map()
    soloPcRef.current?.close()
    soloPcRef.current = null
    soloPending.current = []
    soloRemoteReady.current = false
    setHasRemote(false)
    setQuality(QUALITY_TIER.idle)
    setLinkStats(emptyLinkStats)
  }, [stopStatsLoop])

  const createPeer = useCallback(
    async (stream: MediaStream, remoteVideo: HTMLVideoElement | null, asOfferer: boolean) => {
      clear()
      setQuality(QUALITY_TIER.connecting)
      const iceServers = await fetchIceServers()
      const pc = new RTCPeerConnection({ iceServers })
      soloPcRef.current = pc

      stream.getTracks().forEach((track) => pc.addTrack(track, stream))
      soloRemoteReady.current = false

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
        if (state === RTC_STATE.connected) {
          setQuality(QUALITY_TIER.connecting)
        } else if (state === RTC_STATE.connecting || state === RTC_STATE.new) {
          setQuality(QUALITY_TIER.connecting)
        } else if (state === RTC_STATE.disconnected) {
          setQuality(QUALITY_TIER.poor)
        } else if (state === RTC_STATE.failed || state === RTC_STATE.closed) {
          setQuality(QUALITY_TIER.failed)
        }
      }

      pc.onconnectionstatechange = applyState

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === RTC_STATE.failed) {
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
      }

      if (asOfferer) {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        onSignal({ kind: SIGNAL_KIND.offer, data: offer })
      }

      return pc
    },
    [clear, onSignal],
  )

  const createMeshPeers = useCallback(
    async (
      stream: MediaStream,
      participants: Array<{ userId: number; role: Role }>,
      myUserId: number,
    ) => {
      clear()
      setQuality(QUALITY_TIER.connecting)
      const iceServers = await fetchIceServers()

      for (const participant of participants) {
        if (participant.userId === myUserId) continue
        const pc = new RTCPeerConnection({ iceServers })
        const peer: PeerConnection = {
          pc,
          userId: participant.userId,
          ready: false,
          pendingCandidates: [],
          statsTimer: null,
          statsSeed: null,
        }
        peersRef.current.set(participant.userId, peer)

        stream.getTracks().forEach((track) => pc.addTrack(track, stream))
        wirePcEvents(peer, participant.role === 'offerer', null)

        if (participant.role === 'offerer') {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          onSignal({ kind: SIGNAL_KIND.offer, data: offer }, participant.userId)
        }
      }
    },
    [clear, onSignal, wirePcEvents],
  )

  const handleSignal = useCallback(
    async (
      payload: SignalPayload,
      stream: MediaStream | null,
      remoteVideo: HTMLVideoElement | null,
      fromUserId?: number,
    ) => {
      if (fromUserId != null) {
        const peer = peersRef.current.get(fromUserId)
        if (!peer) return

        if (payload.kind === SIGNAL_KIND.offer) {
          await peer.pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
          peer.ready = true
          await flushCandidates(peer)
          const answer = await peer.pc.createAnswer()
          await peer.pc.setLocalDescription(answer)
          onSignal({ kind: SIGNAL_KIND.answer, data: answer }, fromUserId)
          return
        }

        if (payload.kind === SIGNAL_KIND.answer) {
          await peer.pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
          peer.ready = true
          await flushCandidates(peer)
          return
        }

        if (payload.kind === SIGNAL_KIND.candidate) {
          if (!peer.ready) {
            peer.pendingCandidates.push(payload.data as RTCIceCandidateInit)
            return
          }
          try {
            await peer.pc.addIceCandidate(payload.data as RTCIceCandidateInit)
          } catch {
            /* ignore */
          }
        }
        return
      }

      if (payload.kind === SIGNAL_KIND.offer) {
        let pc = soloPcRef.current
        if (!pc) {
          if (!stream) return
          pc = await createPeer(stream, remoteVideo, false)
        }
        await pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
        soloRemoteReady.current = true
        for (const c of soloPending.current) {
          try {
            await pc.addIceCandidate(c)
          } catch {
            /* ignore */
          }
        }
        soloPending.current = []
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        onSignal({ kind: SIGNAL_KIND.answer, data: answer })
        return
      }

      if (payload.kind === SIGNAL_KIND.answer) {
        const pc = soloPcRef.current
        if (!pc) return
        await pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
        soloRemoteReady.current = true
        for (const c of soloPending.current) {
          try {
            await pc.addIceCandidate(c)
          } catch {
            /* ignore */
          }
        }
        soloPending.current = []
        return
      }

      if (payload.kind === SIGNAL_KIND.candidate) {
        const candidate = payload.data as RTCIceCandidateInit
        const pc = soloPcRef.current
        if (!pc || !soloRemoteReady.current) {
          soloPending.current.push(candidate)
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
    const peers = peersRef.current
    for (const [, peer] of peers) {
      const senders = peer.pc.getSenders()
      for (const track of stream.getTracks()) {
        const sender = senders.find((s) => s.track?.kind === track.kind)
        if (sender) void sender.replaceTrack(track)
      }
    }
    const pc = soloPcRef.current
    if (pc) {
      const senders = pc.getSenders()
      for (const track of stream.getTracks()) {
        const sender = senders.find((s) => s.track?.kind === track.kind)
        if (sender) void sender.replaceTrack(track)
      }
    }
  }, [])

  const restartIce = useCallback(async () => {
    const pc = soloPcRef.current
    if (!pc) return
    try {
      setQuality(QUALITY_TIER.connecting)
      if (pc.restartIce) pc.restartIce()
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      onSignal({ kind: 'offer', data: offer })
    } catch {
      /* ignore */
    }
  }, [onSignal])

  return {
    pcRef: soloPcRef,
    peersRef,
    createPeer,
    createMeshPeers,
    handleSignal,
    clear,
    quality,
    linkStats,
    hasRemote,
    replaceTracks,
    restartIce,
  }
}

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
  /** Unique per-match participant id used to key this peer and route signals. */
  peerId: number
  /** Display user id (may be 0 for guests and is NOT unique across guests). */
  userId: number
  ready: boolean
  pendingCandidates: RTCIceCandidateInit[]
  statsTimer: number | null
  statsSeed: { packetsReceived: number; packetsLost: number; bytesReceived: number; at: number } | null
}

const STATS_INTERVAL_MS = 2000

export function useWebRTC(onSignal: (payload: SignalPayload, targetPeerId?: number) => void) {
  const soloPcRef = useRef<RTCPeerConnection | null>(null)
  const soloPending = useRef<RTCIceCandidateInit[]>([])
  const soloRemoteReady = useRef(false)
  const soloStatsTimer = useRef<number | null>(null)
  const soloStatsSeed = useRef<{ packetsReceived: number; packetsLost: number; bytesReceived: number; at: number } | null>(null)
  const peersRef = useRef<Map<number, PeerConnection>>(new Map())
  const pendingSignalsRef = useRef<Array<{ payload: SignalPayload; fromPeerId: number }>>([])
  const handleSignalRef = useRef<(payload: SignalPayload, stream: MediaStream | null, remoteVideo: HTMLVideoElement | null, fromPeerId?: number) => Promise<void>>(null)
  const [quality, setQuality] = useState<Quality>('idle')
  const [linkStats, setLinkStats] = useState<LinkStats>(emptyLinkStats)
  const [hasRemote, setHasRemote] = useState(false)
  const [peerStreams, setPeerStreams] = useState<Record<number, MediaStream>>({})

  const stopStatsLoop = useCallback((peer: PeerConnection) => {
    if (peer.statsTimer != null) {
      window.clearInterval(peer.statsTimer)
      peer.statsTimer = null
    }
    peer.statsSeed = null
  }, [])

  const sampleStats = useCallback(async (peer: PeerConnection) => {
    const state = peer.pc.connectionState
    //console.debug('[webrtc] sampleStats', { state, userId: peer.userId })
    if (state === RTC_STATE.closed || state === RTC_STATE.failed) return
    try {
      const { stats, seed } = await readLinkStats(peer.pc, peer.statsSeed)
      peer.statsSeed = seed
      setLinkStats(stats)
      const newQuality = qualityFromLink(peer.pc.connectionState, stats)
      //console.debug('[webrtc] sampleStats result', { stats, newQuality })
      setQuality((current) => {
        if (newQuality === QUALITY_TIER.connecting && current === QUALITY_TIER.good) {
          console.debug('[webrtc] sampleStats: keeping good (would regress to connecting)')
          return current
        }
        return newQuality
      })
    } catch {
      /* getStats can throw if pc is closing */
    }
  }, [])

  const startStatsLoop = useCallback(
    (peer: PeerConnection) => {
      stopStatsLoop(peer)
      void sampleStats(peer)
      peer.statsTimer = window.setInterval(() => {
        if (!peersRef.current.has(peer.peerId)) {
          stopStatsLoop(peer)
          return
        }
        void sampleStats(peer)
      }, STATS_INTERVAL_MS)
    },
    [sampleStats, stopStatsLoop],
  )

  const stopSoloStatsLoop = useCallback(() => {
    if (soloStatsTimer.current != null) {
      window.clearInterval(soloStatsTimer.current)
      soloStatsTimer.current = null
    }
    soloStatsSeed.current = null
  }, [])

  const sampleSoloStats = useCallback(async () => {
    const pc = soloPcRef.current
    if (!pc) return
    const state = pc.connectionState
    if (state === RTC_STATE.closed || state === RTC_STATE.failed) return
    try {
      const { stats, seed } = await readLinkStats(pc, soloStatsSeed.current)
      soloStatsSeed.current = seed
      setLinkStats(stats)
      const newQuality = qualityFromLink(pc.connectionState, stats)
      setQuality((current) => {
        if (newQuality === QUALITY_TIER.connecting && current === QUALITY_TIER.good) return current
        return newQuality
      })
    } catch {
      /* getStats can throw if pc is closing */
    }
  }, [])

  const startSoloStatsLoop = useCallback(() => {
    stopSoloStatsLoop()
    void sampleSoloStats()
    soloStatsTimer.current = window.setInterval(() => {
      if (soloPcRef.current == null || soloPcRef.current.connectionState === RTC_STATE.closed) {
        stopSoloStatsLoop()
        return
      }
      void sampleSoloStats()
    }, STATS_INTERVAL_MS)
  }, [sampleSoloStats, stopSoloStatsLoop])

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
          onSignal({ kind: SIGNAL_KIND.candidate, data: event.candidate.toJSON() }, peer.peerId)
        }
      }

      peer.pc.ontrack = (event) => {
        const stream = event.streams[0] ?? null
        if (remoteVideo) {
          remoteVideo.srcObject = stream
        }
        if (stream) {
          setPeerStreams((prev) => (prev[peer.peerId] === stream ? prev : { ...prev, [peer.peerId]: stream }))
        }
        setHasRemote(true)
        if (peer.pc.connectionState === RTC_STATE.connected) {
          setQuality(QUALITY_TIER.good)
        }
      }

      const applyState = () => {
        const state = peer.pc.connectionState
        console.debug('[webrtc] mesh applyState', { state, peerId: peer.peerId, userId: peer.userId })
        if (state === RTC_STATE.connected) {
          setQuality((q) =>
            q === QUALITY_TIER.idle || q === QUALITY_TIER.connecting || q === QUALITY_TIER.failed
              ? QUALITY_TIER.good
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
        const iceState = peer.pc.iceConnectionState
        console.debug('[webrtc] mesh iceStateChange', { iceState, ready: peer.ready, peerId: peer.peerId, userId: peer.userId })
        if (iceState === RTC_STATE.failed) {
          setQuality('failed')
          void (async () => {
            try {
              if (peer.pc.restartIce) peer.pc.restartIce()
              if (asOfferer) {
                const offer = await peer.pc.createOffer({ iceRestart: true })
                await peer.pc.setLocalDescription(offer)
                onSignal({ kind: SIGNAL_KIND.offer, data: offer }, peer.peerId)
              }
            } catch {
              /* ignore */
            }
          })()
        }
        if ((iceState === 'connected' || iceState === 'completed') && peer.ready) {
          console.debug('[webrtc] mesh ice connected -> good')
          setQuality(QUALITY_TIER.good)
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
    stopSoloStatsLoop()
    soloPcRef.current?.close()
    soloPcRef.current = null
    soloPending.current = []
    soloRemoteReady.current = false
    setHasRemote(false)
    setPeerStreams({})
    pendingSignalsRef.current = []
    setQuality(QUALITY_TIER.idle)
    setLinkStats(emptyLinkStats)
  }, [stopStatsLoop, stopSoloStatsLoop])

  const createPeer = useCallback(
    async (stream: MediaStream, remoteVideo: HTMLVideoElement | null, asOfferer: boolean) => {
      console.debug('[webrtc] createPeer', { asOfferer, hasStream: Boolean(stream) })
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
        console.debug('[webrtc] solo ontrack', { connectionState: pc.connectionState })
        if (remoteVideo) {
          remoteVideo.srcObject = event.streams[0] ?? null
        }
        setHasRemote(true)
        setQuality(QUALITY_TIER.good)
      }

      const applyState = () => {
        const state = pc.connectionState
        console.debug('[webrtc] solo applyState', { state })
        if (state === RTC_STATE.connected) {
          setQuality(QUALITY_TIER.good)
          startSoloStatsLoop()
        } else if (state === RTC_STATE.connecting || state === RTC_STATE.new) {
          setQuality(QUALITY_TIER.connecting)
        } else if (state === RTC_STATE.disconnected) {
          setQuality(QUALITY_TIER.poor)
        } else if (state === RTC_STATE.failed || state === RTC_STATE.closed) {
          setQuality(QUALITY_TIER.failed)
          stopSoloStatsLoop()
        }
      }

      pc.onconnectionstatechange = applyState

      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState
        console.debug('[webrtc] solo iceStateChange', { iceState, remoteReady: soloRemoteReady.current })
        if (iceState === RTC_STATE.failed) {
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
        if ((iceState === 'connected' || iceState === 'completed') && soloRemoteReady.current) {
          console.debug('[webrtc] solo ice connected -> good')
          setQuality(QUALITY_TIER.good)
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

  const drainPendingSignals = useCallback(() => {
    if (pendingSignalsRef.current.length === 0 || !handleSignalRef.current) return
    const pending = pendingSignalsRef.current
    pendingSignalsRef.current = []
    for (const { payload, fromPeerId } of pending) {
      handleSignalRef.current(payload, null, null, fromPeerId).catch((err) => {
        console.error('[webrtc] drainPendingSignals failed', { fromPeerId, kind: payload.kind, err })
      })
    }
  }, [])

  const createMeshPeers = useCallback(
    async (
      stream: MediaStream,
      participants: Array<{ peerId: number; userId: number; role: Role }>,
      myPeerId: number,
    ) => {
      clear()
      setQuality(QUALITY_TIER.connecting)
      const iceServers = await fetchIceServers()

      for (const participant of participants) {
        if (participant.peerId === myPeerId) continue
        // Defensive: never create two peers for the same participant id.
        if (peersRef.current.has(participant.peerId)) continue
        const pc = new RTCPeerConnection({ iceServers })
        const peer: PeerConnection = {
          pc,
          peerId: participant.peerId,
          userId: participant.userId,
          ready: false,
          pendingCandidates: [],
          statsTimer: null,
          statsSeed: null,
        }
        peersRef.current.set(participant.peerId, peer)
        stream.getTracks().forEach((track) => pc.addTrack(track, stream))
        wirePcEvents(peer, participant.role === 'offerer', null)
        drainPendingSignals()

        if (participant.role === 'offerer') {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          onSignal({ kind: SIGNAL_KIND.offer, data: offer }, participant.peerId)
        }
      }
      drainPendingSignals()
    },
    [clear, onSignal, wirePcEvents, drainPendingSignals],
  )

  const handleSignal = useCallback(
    async (
      payload: SignalPayload,
      stream: MediaStream | null,
      remoteVideo: HTMLVideoElement | null,
      fromPeerId?: number,
    ) => {
      if (fromPeerId != null) {
        const peer = peersRef.current.get(fromPeerId)
        if (!peer) {
          pendingSignalsRef.current.push({ payload, fromPeerId })
          return
        }

        try {
          if (payload.kind === SIGNAL_KIND.offer) {
            const sigState = peer.pc.signalingState
            if (sigState !== 'stable') {
              if (sigState === 'have-local-offer') {
                // Glare: both sides offered. The lower peerId wins and keeps
                // its offer; the higher peerId rolls back and accepts theirs.
                if (peer.peerId < fromPeerId) {
                  console.debug('[webrtc] mesh glare: ignoring remote offer (lower peerId wins)', { peerId: peer.peerId, fromPeerId })
                  return
                }
                await peer.pc.setLocalDescription({ type: 'rollback' } as unknown as RTCSessionDescriptionInit)
              } else {
                // e.g. 'have-remote-offer': a duplicate offer arrived while the
                // first is still being answered. Ignore it instead of throwing.
                console.debug('[webrtc] mesh ignoring offer in non-stable state', { sigState, peerId: peer.peerId, fromPeerId })
                return
              }
            }
            await peer.pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
            peer.ready = true
            await flushCandidates(peer)
            const answer = await peer.pc.createAnswer()
            await peer.pc.setLocalDescription(answer)
            onSignal({ kind: SIGNAL_KIND.answer, data: answer }, fromPeerId)
            return
          }

          if (payload.kind === SIGNAL_KIND.answer) {
            if (peer.pc.signalingState !== 'have-local-offer') {
              console.debug('[webrtc] mesh ignoring answer in unexpected state', { sigState: peer.pc.signalingState, peerId: peer.peerId, fromPeerId })
              return
            }
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
        } catch (err) {
          console.error('[webrtc] mesh handleSignal failed', { fromPeerId, kind: payload.kind, err })
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

  handleSignalRef.current = handleSignal

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
    peerStreams,
    replaceTracks,
    restartIce,
  }
}

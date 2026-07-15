import { useCallback, useRef, useState } from 'preact/hooks'
import { fetchIceServers } from '../api'

type SignalPayload = { kind: 'offer' | 'answer' | 'candidate'; data: unknown }

export function useWebRTC(onSignal: (payload: SignalPayload) => void) {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const remoteReady = useRef(false)
  const [quality, setQuality] = useState<'idle' | 'connecting' | 'good' | 'poor' | 'failed'>('idle')
  const [hasRemote, setHasRemote] = useState(false)

  const clear = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    pendingCandidates.current = []
    remoteReady.current = false
    setHasRemote(false)
    setQuality('idle')
  }, [])

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

  const createPeer = useCallback(
    async (stream: MediaStream, remoteVideo: HTMLVideoElement | null, asOfferer: boolean) => {
      clear()
      setQuality('connecting')
      const iceServers = await fetchIceServers()
      const pc = new RTCPeerConnection({ iceServers })
      pcRef.current = pc

      stream.getTracks().forEach((track) => pc.addTrack(track, stream))

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          onSignal({ kind: 'candidate', data: event.candidate.toJSON() })
        }
      }

      pc.ontrack = (event) => {
        if (remoteVideo) {
          remoteVideo.srcObject = event.streams[0] ?? null
        }
        setHasRemote(true)
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected') setQuality('good')
        else if (state === 'connecting' || state === 'new') setQuality('connecting')
        else if (state === 'disconnected') setQuality('poor')
        else if (state === 'failed' || state === 'closed') setQuality('failed')
      }

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') setQuality('failed')
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setQuality('good')
      }

      if (asOfferer) {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        onSignal({ kind: 'offer', data: offer })
      }

      return pc
    },
    [clear, onSignal],
  )

  const handleSignal = useCallback(
    async (payload: SignalPayload, stream: MediaStream | null, remoteVideo: HTMLVideoElement | null) => {
      if (payload.kind === 'offer') {
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
        onSignal({ kind: 'answer', data: answer })
        return
      }

      if (payload.kind === 'answer') {
        const pc = pcRef.current
        if (!pc) return
        await pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit)
        remoteReady.current = true
        await flushCandidates(pc)
        return
      }

      if (payload.kind === 'candidate') {
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

  return { pcRef, createPeer, handleSignal, clear, quality, hasRemote, replaceTracks }
}

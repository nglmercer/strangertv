import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { MatchPreferences } from '../../shared/types'
import type { Messages } from '../i18n'
import type { ChatMessage } from '../types/ui'
import { mediaErrorMessage } from '../utils/mediaErrors'
import { notifyMatch, playMatchSound } from '../utils/notify'
import { PEER_LEFT_REASON, SignalKind, STORAGE_KEYS, TIMING_MS, WS_MESSAGE_TYPE } from '../../shared/constants'
import { useMatchSocket } from './useMatchSocket'
import { useMedia } from './useMedia'
import { useWebRTC } from './useWebRTC'

type Options = {
  tr: Messages
  prefs: MatchPreferences
  autoNext: boolean
  onStatus: (s: string) => void
}

/**
 * Orchestrates media, signaling socket, WebRTC, queue, chat, and call lifecycle.
 */
export function useMatchSession({ tr, prefs, autoNext, onStatus }: Options) {
  const [finding, setFinding] = useState(false)
  const [matched, setMatched] = useState(false)
  const [queuePos, setQueuePos] = useState<number | undefined>()
  const [online, setOnline] = useState(0)
  const [waitingCount, setWaitingCount] = useState(0)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [sharedInterests, setSharedInterests] = useState<string[]>([])
  const [peerCountry, setPeerCountry] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [streamTick, setStreamTick] = useState(0)
  const [callSeconds, setCallSeconds] = useState(0)
  const [rateRoomId, setRateRoomId] = useState<string | null>(null)
  const [longWait, setLongWait] = useState(false)

  const localVideo = useRef<HTMLVideoElement>(null)
  const remoteVideo = useRef<HTMLVideoElement>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const matchedAt = useRef<number | null>(null)
  const waitingSince = useRef<number | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const autoNextRef = useRef(autoNext)
  autoNextRef.current = autoNext
  const trRef = useRef(tr)
  trRef.current = tr
  const callSecondsRef = useRef(0)
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId
  const findingRef = useRef(finding)
  findingRef.current = finding
  const matchedRef = useRef(matched)
  matchedRef.current = matched

  const media = useMedia()
  const mediaRef = useRef(media)
  mediaRef.current = media

  const signalOut = useRef<(payload: { kind: SignalKind; data: unknown }) => void>(() => undefined)
  const onSignalOut = useCallback((payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown }) => {
    signalOut.current(payload)
  }, [])

  const webrtc = useWebRTC(onSignalOut)
  const webrtcRef = useRef(webrtc)
  webrtcRef.current = webrtc

  const beginMatchRef = useRef<() => Promise<boolean>>(async () => false)

  const clearPeerUi = () => {
    setMatched(false)
    setRoomId(null)
    setSharedInterests([])
    setPeerCountry('')
    matchedAt.current = null
    if (remoteVideo.current) remoteVideo.current.srcObject = null
  }

  const match = useMatchSocket({
    onWaiting: (position, onl) => {
      onStatus(trRef.current.finding)
      setQueuePos(position)
      if (onl != null) setOnline(onl)
      setMatched(false)
      if (!waitingSince.current) waitingSince.current = Date.now()
      webrtcRef.current.clear()
      if (remoteVideo.current) remoteVideo.current.srcObject = null
    },
    onMatched: async (id, role, meta) => {
      setRoomId(id)
      setMatched(true)
      waitingSince.current = null
      setLongWait(false)
      matchedAt.current = Date.now()
      setCallSeconds(0)
      onStatus(trRef.current.connecting)
      setQueuePos(undefined)
      setSharedInterests(meta?.sharedInterests ?? [])
      setPeerCountry(meta?.peerCountry && meta.peerCountry !== 'any' ? meta.peerCountry : '')
      if (localStorage.getItem(STORAGE_KEYS.matchSound) !== '0') playMatchSound()
      if (localStorage.getItem(STORAGE_KEYS.matchNotify) === '1') {
        notifyMatch(trRef.current.brand, trRef.current.connecting)
      }
      const stream = mediaRef.current.streamRef.current
      if (!stream) return
      await webrtcRef.current.createPeer(stream, remoteVideo.current, role === 'offerer')
    },
    onPeerLeft: (reason) => {
      const endedRoom = roomIdRef.current
      webrtcRef.current.clear()
      clearPeerUi()
      if (endedRoom && callSecondsRef.current >= 5 && !autoNextRef.current) {
        setRateRoomId(endedRoom)
      }
      const t = trRef.current
      const statusMsg =
        reason === PEER_LEFT_REASON.blocked || reason === PEER_LEFT_REASON.reported
          ? t.peerLeftBlocked
          : reason === PEER_LEFT_REASON.next
            ? t.peerLeftNext
            : reason === PEER_LEFT_REASON.leave
              ? t.peerLeftLeave
              : t.peerLeft
      if (autoNextRef.current && reason !== PEER_LEFT_REASON.blocked && reason !== PEER_LEFT_REASON.reported) {
        setFinding(true)
        onStatus(t.requeueing)
        setChat([])
        window.setTimeout(() => matchRef.current?.next(prefsRef.current), TIMING_MS.requeueDelay)
      } else {
        setFinding(false)
        onStatus(statusMsg)
      }
    },
    onSignal: (payload) => {
      void webrtcRef.current.handleSignal(payload, mediaRef.current.streamRef.current, remoteVideo.current)
    },
    onChat: (text, time) => setChat((m) => [...m, { text, time, mine: false }]),
    onStats: (onl, wait) => {
      setOnline(onl)
      setWaitingCount(wait)
    },
    onError: (_code, message) => {
      onStatus(message)
      setFinding(false)
    },
    onReportAck: () => {
      webrtcRef.current.clear()
      setMatched(false)
      setFinding(false)
      setRoomId(null)
      onStatus(trRef.current.reportThanks)
    },
    onBlockAck: () => {
      webrtcRef.current.clear()
      setFinding(false)
      clearPeerUi()
      onStatus(trRef.current.blocked)
    },
    onDraining: (message) => {
      webrtcRef.current.clear()
      setFinding(false)
      setMatched(false)
      onStatus(message || trRef.current.draining)
      if (findingRef.current || matchedRef.current) {
        window.setTimeout(() => {
          onStatus(trRef.current.reconnecting)
          void beginMatchRef.current?.()
        }, 10_000)
      }
    },
  })

  const matchRef = useRef(match)
  matchRef.current = match
  signalOut.current = (payload) => match.send({ type: WS_MESSAGE_TYPE.signal, payload })

  useEffect(() => {
    if (!matched) {
      setCallSeconds(0)
      callSecondsRef.current = 0
      return
    }
    const iv = window.setInterval(() => {
      if (!matchedAt.current) return
      const sec = Math.floor((Date.now() - matchedAt.current) / 1000)
      setCallSeconds(sec)
      callSecondsRef.current = sec
    }, 1000)
    return () => clearInterval(iv)
  }, [matched])

  useEffect(() => {
    if (!finding || matched) {
      setLongWait(false)
      if (!finding) waitingSince.current = null
      return
    }
    if (!waitingSince.current) waitingSince.current = Date.now()
    const iv = window.setInterval(() => {
      if (!waitingSince.current) return
      setLongWait(Date.now() - waitingSince.current > TIMING_MS.longWait)
    }, 5000)
    return () => clearInterval(iv)
  }, [finding, matched])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat])

  useEffect(() => {
    if (!matched || webrtc.quality === 'idle') return
    match.send({
      type: WS_MESSAGE_TYPE.telemetryQuality,
      roomId: roomId ?? undefined,
      quality: webrtc.quality,
    })
  }, [webrtc.quality, matched, roomId, match])

  useEffect(() => {
    if (localVideo.current && media.streamRef.current) {
      localVideo.current.srcObject = media.streamRef.current
    }
  }, [finding, streamTick, media.streamRef])

  const beginMatch = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await media.ensureStream()
      setStreamTick((n) => n + 1)
      if (localVideo.current) localVideo.current.srcObject = stream
      setChat([])
      setFinding(true)
      setMatched(false)
      onStatus(trRef.current.finding)
      match.join(prefsRef.current)
      return true
    } catch {
      const code = media.errorCode
      onStatus(mediaErrorMessage(trRef.current, code))
      setFinding(false)
      return false
    }
  }, [media, match, onStatus])

  beginMatchRef.current = beginMatch

  const stop = useCallback(() => {
    const endedRoom = roomIdRef.current
    const duration = callSecondsRef.current
    match.leave()
    webrtc.clear()
    clearPeerUi()
    setFinding(false)
    setQueuePos(undefined)
    onStatus(trRef.current.ready)
    if (endedRoom && duration >= 5) setRateRoomId(endedRoom)
  }, [match, webrtc, onStatus])

  const next = useCallback(() => {
    const endedRoom = roomIdRef.current
    const duration = callSecondsRef.current
    webrtc.clear()
    if (remoteVideo.current) remoteVideo.current.srcObject = null
    setChat([])
    setMatched(false)
    setSharedInterests([])
    setPeerCountry('')
    matchedAt.current = null
    onStatus(trRef.current.finding)
    setFinding(true)
    match.next(prefsRef.current)
    if (endedRoom && duration >= 5) setRateRoomId(endedRoom)
  }, [match, webrtc, onStatus])

  const sendChat = useCallback(
    (event: Event) => {
      event.preventDefault()
      const text = chatText.trim().slice(0, 500)
      if (!text || !matched) return
      const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      setChat((m) => [...m, { text, time, mine: true }])
      match.send({ type: WS_MESSAGE_TYPE.chat, payload: { text, time } })
      setChatText('')
    },
    [chatText, matched, match],
  )

  const bumpStream = useCallback(async () => {
    const s = await media.ensureStream()
    setStreamTick((n) => n + 1)
    if (localVideo.current) localVideo.current.srcObject = s
    webrtc.replaceTracks(s)
    return s
  }, [media, webrtc])

  /** Switch cam/mic and push new tracks into the peer connection. */
  const changeDevice = useCallback(
    async (kind: 'video' | 'audio', id: string) => {
      const s = await media.switchDevice(kind, id)
      setStreamTick((n) => n + 1)
      if (localVideo.current) localVideo.current.srcObject = s
      webrtc.replaceTracks(s)
      return s
    },
    [media, webrtc],
  )

  return {
    media,
    webrtc,
    match,
    finding,
    matched,
    queuePos,
    online,
    waitingCount,
    setOnline,
    setWaitingCount,
    roomId,
    sharedInterests,
    peerCountry,
    chat,
    chatText,
    setChatText,
    streamTick,
    setStreamTick,
    callSeconds,
    rateRoomId,
    setRateRoomId,
    longWait,
    localVideo,
    remoteVideo,
    messagesEnd,
    beginMatch,
    stop,
    next,
    sendChat,
    bumpStream,
    changeDevice,
  }
}

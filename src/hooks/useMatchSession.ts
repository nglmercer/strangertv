import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { GroupMatchPeer, GroupVisibility, MatchMode, MatchPreferences, PublicUser, RelationshipStatus } from '../../shared/types'
import type { Messages } from '../i18n'
import type { ChatMessage } from '../types/ui'
import { mediaErrorMessage } from '../utils/mediaErrors'
import { notifyMatch, playMatchSound } from '../utils/notify'
import { PEER_LEFT_REASON, QUALITY_TIER, SignalKind, TIMING_MS, WS_MESSAGE_TYPE } from '../../shared/constants'
import { isMatchNotifyEnabled, isMatchSoundEnabled } from '../utils/storage'
import { messagesApi } from '../api'
import { useMatchSocket } from './useMatchSocket'
import { useMedia } from './useMedia'
import { useWebRTC } from './useWebRTC'

type Options = {
  tr: Messages
  prefs: MatchPreferences
  onStatus: (s: string) => void
  onGroupMessage?: (message: any) => void
  onSocialEvent?: (msg: SocialWsEvent) => void
  onGroupInvite?: (inviteId: number, groupId: number, groupName: string, inviter: PublicUser) => void
  onGroupInviteAccepted?: (inviteId: number, groupId: number, userId: number) => void
  onGroupInviteDeclined?: (inviteId: number, groupId: number, userId: number) => void
}

export type SocialWsEvent =
  | { type: 'friend:request'; friendId: number; from: { id: number; email: string } }
  | { type: 'friend:accepted'; friendId: number; from: { id: number; email: string } }
  | { type: 'friend:declined'; friendId: number }
  | { type: 'friend:removed'; friendId: number }
  | { type: 'message:new'; message: { id: number; senderId: number; recipientId: number; text: string; createdAt: string } }
  | { type: 'invitation:send'; invitationId: number; roomId: string; inviter: { id: number; email: string } }
  | { type: 'group:invite'; inviteId: number; groupId: number; groupName: string; inviter: { id: number; email: string } }
  | { type: 'group:invite:accepted'; inviteId: number; groupId: number; userId: number }
  | { type: 'group:invite:declined'; inviteId: number; groupId: number; userId: number }
  | { type: 'group-match:invite-received'; roomId: string; host: PublicUser }
  | { type: 'group-match:participant-joined'; roomId: string; userId: number; email?: string }
  | { type: 'group-match:participant-left'; roomId: string; userId: number }

export type GroupMatchParticipant = {
  userId: number
  email?: string
  country?: string
}

export function useMatchSession({ tr, prefs, onStatus, onGroupMessage, onSocialEvent, onGroupInvite, onGroupInviteAccepted, onGroupInviteDeclined }: Options) {
  const [finding, setFinding] = useState(false)
  const [matched, setMatched] = useState(false)
  const [queuePos, setQueuePos] = useState<number | undefined>()
  const [online, setOnline] = useState(0)
  const [waitingCount, setWaitingCount] = useState(0)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [sharedInterests, setSharedInterests] = useState<string[]>([])
  const [peerCountry, setPeerCountry] = useState('')
  const [peerEmail, setPeerEmail] = useState<string | null>(null)
  const [peerUserId, setPeerUserId] = useState<number | null>(null)
  const [relationship, setRelationship] = useState<RelationshipStatus>('none')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [streamTick, setStreamTick] = useState(0)
  const [callSeconds, setCallSeconds] = useState(0)
  const [rateRoomId, setRateRoomId] = useState<string | null>(null)
  const [longWait, setLongWait] = useState(false)
  const [matchMode, setMatchMode] = useState<MatchMode>('solo')
  const [groupRoomId, setGroupRoomId] = useState<string | null>(null)
  const [groupVisibility, setGroupVisibility] = useState<GroupVisibility>('public')
  const [groupParticipants, setGroupParticipants] = useState<GroupMatchParticipant[]>([])
  const [groupPeers, setGroupPeers] = useState<GroupMatchPeer[]>([])

  const localVideo = useRef<HTMLVideoElement>(null)
  const remoteVideo = useRef<HTMLVideoElement>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const matchedAt = useRef<number | null>(null)
  const waitingSince = useRef<number | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const trRef = useRef(tr)
  trRef.current = tr
  const callSecondsRef = useRef(0)
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId
  const findingRef = useRef(finding)
  findingRef.current = finding
  const matchedRef = useRef(matched)
  matchedRef.current = matched
  const groupRoomIdRef = useRef(groupRoomId)
  groupRoomIdRef.current = groupRoomId

  const media = useMedia()
  const mediaRef = useRef(media)
  mediaRef.current = media

  const signalOut = useRef<(payload: { kind: SignalKind; data: unknown }, targetUserId?: number) => void>(() => undefined)
  const onSignalOut = useCallback((payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown }, targetUserId?: number) => {
    signalOut.current(payload, targetUserId)
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
    setPeerEmail(null)
    setPeerUserId(null)
    setRelationship('none')
    setGroupPeers([])
    matchedAt.current = null
    if (remoteVideo.current) remoteVideo.current.srcObject = null
  }

  const clearGroupState = () => {
    setGroupRoomId(null)
    setGroupVisibility('public')
    setGroupParticipants([])
    groupRoomIdRef.current = null
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
      console.debug('[match] onMatched', { roomId: id, role, peerUserId: meta?.peerUserId, relationship: meta?.relationship })
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
      setPeerEmail(meta?.peerEmail ?? null)
      setPeerUserId(meta?.peerUserId ?? null)
      const rel = meta?.relationship ?? 'none'
      setRelationship(rel)
      if (rel !== 'none' && meta?.peerUserId) {
        try {
          const { messages } = await messagesApi.getConversation(meta.peerUserId, 50)
          if (messages.length > 0) {
            setChat(messages.map((m) => ({
              text: m.text,
              time: m.createdAt,
              mine: m.senderId !== meta.peerUserId,
            })))
          }
        } catch {
          /* ignore */
        }
      }
      if (isMatchSoundEnabled()) playMatchSound()
      if (isMatchNotifyEnabled()) {
        notifyMatch(trRef.current.brand, trRef.current.connecting)
      }
      const stream = mediaRef.current.streamRef.current
      if (!stream) return
      await webrtcRef.current.createPeer(stream, remoteVideo.current, role === 'offerer')
    },
    onPeerLeft: (reason) => {
      console.debug('[match] onPeerLeft', { reason, finding: findingRef.current, matched: matchedRef.current, callSec: callSecondsRef.current })
      webrtcRef.current.clear()
      clearPeerUi()
      const t = trRef.current
      if (reason === PEER_LEFT_REASON.blocked || reason === PEER_LEFT_REASON.reported) {
        setFinding(false)
        onStatus(t.peerLeftBlocked)
        return
      }
      setFinding(true)
      onStatus(t.requeueing)
      setChat([])
      window.setTimeout(() => {
        if (groupRoomIdRef.current) {
          matchRef.current?.groupMatchStart(groupRoomIdRef.current)
        } else {
          matchRef.current?.next(prefsRef.current)
        }
      }, TIMING_MS.requeueDelay)
    },
    onSignal: (payload, fromUserId) => {
      void webrtcRef.current.handleSignal(payload, mediaRef.current.streamRef.current, remoteVideo.current, fromUserId)
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
    onGroupMessage: onGroupMessage,
    onFriendRequest: (friendId, from) => onSocialEvent?.({ type: 'friend:request', friendId, from }),
    onFriendAccepted: (friendId, from) => onSocialEvent?.({ type: 'friend:accepted', friendId, from }),
    onFriendDeclined: (friendId) => onSocialEvent?.({ type: 'friend:declined', friendId }),
    onFriendRemoved: (friendId) => onSocialEvent?.({ type: 'friend:removed', friendId }),
    onMessageNew: (message) => onSocialEvent?.({ type: 'message:new', message }),
    onInvitation: (invitationId, roomId, inviter) => onSocialEvent?.({ type: 'invitation:send', invitationId, roomId, inviter }),
    onGroupInvite: (inviteId, groupId, groupName, inviter) => {
      onSocialEvent?.({ type: 'group:invite', inviteId, groupId, groupName, inviter })
      onGroupInvite?.(inviteId, groupId, groupName, inviter)
    },
    onGroupInviteAccepted: (inviteId, groupId, userId) => {
      onSocialEvent?.({ type: 'group:invite:accepted', inviteId, groupId, userId })
      onGroupInviteAccepted?.(inviteId, groupId, userId)
    },
    onGroupInviteDeclined: (inviteId, groupId, userId) => {
      onSocialEvent?.({ type: 'group:invite:declined', inviteId, groupId, userId })
      onGroupInviteDeclined?.(inviteId, groupId, userId)
    },
    onGroupMatchCreated: (id, visibility) => {
      setGroupRoomId(id)
      setGroupVisibility(visibility)
      groupRoomIdRef.current = id
    },
    onGroupMatchParticipantJoined: (id, userId, email) => {
      setGroupParticipants((prev) => [...prev.filter((p) => p.userId !== userId), { userId, email }])
    },
    onGroupMatchParticipantLeft: (id, userId) => {
      setGroupParticipants((prev) => prev.filter((p) => p.userId !== userId))
    },
    onGroupMatchInviteReceived: (id, host) => {
      onSocialEvent?.({ type: 'group-match:invite-received', roomId: id, host })
    },
    onGroupMatchInviteSent: () => {
      /* no-op for now */
    },
    onGroupMatchMatched: async (id, role, peers, interests) => {
      console.debug('[match] group-match:matched', { roomId: id, role, peerCount: peers.length })
      setRoomId(id)
      setMatched(true)
      setGroupPeers(peers)
      setSharedInterests(interests)
      waitingSince.current = null
      setLongWait(false)
      matchedAt.current = Date.now()
      setCallSeconds(0)
      onStatus(trRef.current.connecting)
      setQueuePos(undefined)
      if (isMatchSoundEnabled()) playMatchSound()
      if (isMatchNotifyEnabled()) {
        notifyMatch(trRef.current.brand, trRef.current.connecting)
      }
      const stream = mediaRef.current.streamRef.current
      if (!stream) return
      await webrtcRef.current.createMeshPeers(
        stream,
        peers.map((p) => ({ userId: p.userId, role: p.role })),
        peers[0]?.userId ?? 0,
      )
    },
  })

  const matchRef = useRef(match)
  matchRef.current = match
  signalOut.current = (payload, targetUserId) => {
    if (targetUserId != null) {
      match.sendSignal(payload, targetUserId)
    } else {
      match.send({ type: WS_MESSAGE_TYPE.signal, payload })
    }
  }

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
    if (chat.length > 0) {
      messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chat])

  useEffect(() => {
    if (!matched || webrtc.quality === QUALITY_TIER.idle) return
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

  const beginGroupMatch = useCallback(async (visibility: GroupVisibility, groupPrefs: MatchPreferences): Promise<boolean> => {
    try {
      const stream = await media.ensureStream()
      setStreamTick((n) => n + 1)
      if (localVideo.current) localVideo.current.srcObject = stream
      setMatchMode('group')
      match.groupMatchCreate(visibility, groupPrefs)
      return true
    } catch {
      const code = media.errorCode
      onStatus(mediaErrorMessage(trRef.current, code))
      setFinding(false)
      return false
    }
  }, [media, match, onStatus])

  const startGroupQueue = useCallback(() => {
    if (groupRoomId) {
      setFinding(true)
      match.groupMatchStart(groupRoomId)
    }
  }, [groupRoomId, match])

  const stop = useCallback(() => {
    console.debug('[match] stop()', { roomId: roomIdRef.current, duration: callSecondsRef.current })
    const endedRoom = roomIdRef.current
    const duration = callSecondsRef.current
    match.leave()
    match.groupMatchLeave()
    webrtc.clear()
    clearPeerUi()
    clearGroupState()
    setFinding(false)
    setQueuePos(undefined)
    setMatchMode('solo')
    onStatus(trRef.current.ready)
    if (endedRoom && duration >= 5) setRateRoomId(endedRoom)
  }, [match, webrtc, onStatus])

  const next = useCallback(() => {
    console.debug('[match] next()', { roomId: roomIdRef.current, duration: callSecondsRef.current })
    webrtc.clear()
    if (remoteVideo.current) remoteVideo.current.srcObject = null
    setChat([])
    setMatched(false)
    setSharedInterests([])
    setPeerCountry('')
    matchedAt.current = null
    onStatus(trRef.current.finding)
    setFinding(true)
    if (groupRoomIdRef.current) {
      match.groupMatchStart(groupRoomIdRef.current)
    } else {
      match.next(prefsRef.current)
    }
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
    peerEmail,
    peerUserId,
    relationship,
    setRelationship,
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
    beginGroupMatch,
    startGroupQueue,
    stop,
    next,
    sendChat,
    bumpStream,
    changeDevice,
    matchMode,
    groupRoomId,
    groupVisibility,
    groupParticipants,
    groupPeers,
    setMatchMode,
  }
}

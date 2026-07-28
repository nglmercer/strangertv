import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { getToken, wsUrl } from '../api'
import type { ClientMessage, GroupMatchPeer, GroupMessage, GroupVisibility, MatchPreferences, MatchScope, Message, PublicUser, RelationshipStatus, Role, ServerMessage } from '../../shared/types'
import { WS_MESSAGE_TYPE, TIMING_MS } from '../../shared/constants'

type Handlers = {
  onWaiting?: (position?: number, online?: number) => void
  onMatched?: (
    roomId: string,
    role: Role,
    meta?: { peerCountry?: string; peerEmail?: string; peerUserId?: number; sharedInterests?: string[]; relationship?: RelationshipStatus },
  ) => void
  onPeerLeft?: (reason?: string) => void
  onSignal?: (payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown }, fromUserId?: number) => void
  onChat?: (text: string, time: string) => void
  onStats?: (online: number, waiting: number) => void
  onError?: (code: string, message: string) => void
  onReportAck?: () => void
  onBlockAck?: () => void
  onDraining?: (message?: string) => void
  onGroupMessage?: (message: GroupMessage) => void
  onFriendRequest?: (friendId: number, from: PublicUser) => void
  onFriendAccepted?: (friendId: number, from: PublicUser) => void
  onFriendDeclined?: (friendId: number) => void
  onFriendRemoved?: (friendId: number) => void
  onMessageNew?: (message: Message) => void
  onInvitation?: (invitationId: number, roomId: string, inviter: PublicUser) => void
  onInvitationAccepted?: (invitationId: number, roomId: string) => void
  onInvitationDeclined?: (invitationId: number) => void
  onGroupInvite?: (inviteId: number, groupId: number, groupName: string, inviter: PublicUser) => void
  onGroupInviteAccepted?: (inviteId: number, groupId: number, userId: number) => void
  onGroupInviteDeclined?: (inviteId: number, groupId: number, userId: number) => void
  onGroupMatchCreated?: (roomId: string, visibility: GroupVisibility) => void
  onGroupMatchParticipantJoined?: (roomId: string, userId: number, email?: string) => void
  onGroupMatchParticipantLeft?: (roomId: string, userId: number) => void
  onGroupMatchInviteReceived?: (roomId: string, host: PublicUser) => void
  onGroupMatchInviteSent?: (userId: number) => void
  onGroupMatchMatched?: (roomId: string, role: Role, peers: GroupMatchPeer[], sharedInterests: string[]) => void
}

export function useMatchSocket(handlers: Handlers) {
  const socket = useRef<WebSocket | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [connected, setConnected] = useState(false)
  const heartbeatTimer = useRef<number | null>(null)
  const reconnectTimer = useRef<number | null>(null)

  const stopHeartbeat = () => {
    if (heartbeatTimer.current != null) {
      window.clearInterval(heartbeatTimer.current)
      heartbeatTimer.current = null
    }
  }

  const stopReconnect = () => {
    if (reconnectTimer.current != null) {
      window.clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
  }

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      // console.debug('[ws] send', { type: message.type, payload: message })
      socket.current.send(JSON.stringify(message))
    } else {
      console.debug('[ws] send dropped, socket not open', { type: message.type, readyState: socket.current?.readyState })
    }
  }, [])

  const sendSignal = useCallback((payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown }, targetUserId?: number) => {
    const msg: any = { type: WS_MESSAGE_TYPE.signal, payload }
    if (targetUserId != null) msg.targetUserId = targetUserId
    send(msg)
  }, [send])

  const ensureSocket = useCallback(() => {
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) return socket.current

    const ws = new WebSocket(wsUrl())
    socket.current = ws

    ws.onopen = () => {
      setConnected(true)
      stopHeartbeat()
      heartbeatTimer.current = window.setInterval(() => {
        send({ type: WS_MESSAGE_TYPE.queueHeartbeat })
      }, TIMING_MS.wsHeartbeat)
      const token = getToken()
      if (token) ws.send(JSON.stringify({ type: WS_MESSAGE_TYPE.wsAuth, token }))
    }

    ws.onclose = () => {
      setConnected(false)
      stopHeartbeat()
      stopReconnect()
      reconnectTimer.current = window.setTimeout(() => ensureSocket(), 3000)
    }

    ws.onerror = () => {
      setConnected(false)
    }

    ws.onmessage = ({ data }) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(data)) as ServerMessage
      } catch {
        return
      }
      const h = handlersRef.current
      switch (msg.type) {
        case WS_MESSAGE_TYPE.queueWaiting:
          h.onWaiting?.(msg.position, msg.online)
          break
        case WS_MESSAGE_TYPE.roomMatched:
          h.onMatched?.(msg.roomId, msg.role, {
            peerCountry: msg.peerCountry,
            peerEmail: msg.peerEmail,
            peerUserId: msg.peerUserId,
            sharedInterests: msg.sharedInterests,
            relationship: msg.relationship,
          })
          break
        case WS_MESSAGE_TYPE.roomPeerLeft:
          h.onPeerLeft?.(msg.reason)
          break
        case WS_MESSAGE_TYPE.signal:
          h.onSignal?.(msg.payload, (msg as any).targetUserId)
          break
        case WS_MESSAGE_TYPE.chat:
          h.onChat?.(msg.payload.text, msg.payload.time)
          break
        case WS_MESSAGE_TYPE.stats:
          h.onStats?.(msg.online, msg.waiting)
          break
        case WS_MESSAGE_TYPE.error:
          h.onError?.(msg.code, msg.message)
          break
        case WS_MESSAGE_TYPE.reportAck:
          h.onReportAck?.()
          break
        case WS_MESSAGE_TYPE.blockAck:
          h.onBlockAck?.()
          break
        case WS_MESSAGE_TYPE.serverDraining:
          h.onDraining?.(msg.message)
          break
        case WS_MESSAGE_TYPE.groupMessageNew:
          h.onGroupMessage?.(msg.message)
          break
        case WS_MESSAGE_TYPE.friendRequest:
          h.onFriendRequest?.(msg.friendId, msg.from)
          break
        case WS_MESSAGE_TYPE.friendAccepted:
          h.onFriendAccepted?.(msg.friendId, msg.from)
          break
        case WS_MESSAGE_TYPE.friendDeclined:
          h.onFriendDeclined?.(msg.friendId)
          break
        case WS_MESSAGE_TYPE.friendRemoved:
          h.onFriendRemoved?.(msg.friendId)
          break
        case WS_MESSAGE_TYPE.messageNew:
          h.onMessageNew?.(msg.message)
          break
        case WS_MESSAGE_TYPE.invitationSend:
          console.debug('[ws] received invitation', { invitationId: msg.invitationId, roomId: msg.roomId, inviter: msg.inviter })
          h.onInvitation?.(msg.invitationId, msg.roomId, msg.inviter)
          break
        default:
          console.debug('[ws] unhandled message type', { type: msg.type })
          break
        case WS_MESSAGE_TYPE.invitationAccepted:
          h.onInvitationAccepted?.(msg.invitationId, msg.roomId)
          break
        case WS_MESSAGE_TYPE.invitationDeclined:
          h.onInvitationDeclined?.(msg.invitationId)
          break
        case 'group:invite':
          h.onGroupInvite?.(msg.inviteId, msg.groupId, msg.groupName, msg.inviter)
          break
        case 'group:invite:accepted':
          h.onGroupInviteAccepted?.(msg.inviteId, msg.groupId, msg.userId)
          break
        case 'group:invite:declined':
          h.onGroupInviteDeclined?.(msg.inviteId, msg.groupId, msg.userId)
          break
        case WS_MESSAGE_TYPE.groupMatchCreated:
          h.onGroupMatchCreated?.(msg.roomId, msg.visibility)
          break
        case WS_MESSAGE_TYPE.groupMatchParticipantJoined:
          h.onGroupMatchParticipantJoined?.(msg.roomId, msg.userId, msg.email)
          break
        case WS_MESSAGE_TYPE.groupMatchParticipantLeft:
          h.onGroupMatchParticipantLeft?.(msg.roomId, msg.userId)
          break
        case WS_MESSAGE_TYPE.groupMatchInviteReceived:
          h.onGroupMatchInviteReceived?.(msg.roomId, msg.host)
          break
        case WS_MESSAGE_TYPE.groupMatchInviteSent:
          h.onGroupMatchInviteSent?.(msg.userId)
          break
        case WS_MESSAGE_TYPE.groupMatchMatched:
          h.onGroupMatchMatched?.(msg.roomId, msg.role, msg.peers, msg.sharedInterests)
          break
      }
    }

    return ws
  }, [send])

  const join = useCallback(
    (preferences: MatchPreferences) => {
      const ws = ensureSocket()
      const payload: ClientMessage = {
        type: WS_MESSAGE_TYPE.queueJoin,
        preferences,
        token: getToken() ?? undefined,
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
      else {
        ws.addEventListener(
          'open',
          () => {
            ws.send(JSON.stringify(payload))
          },
          { once: true },
        )
      }
    },
    [ensureSocket],
  )

  const next = useCallback(
    (preferences: MatchPreferences) => {
      ensureSocket()
      send({ type: WS_MESSAGE_TYPE.roomNext, preferences, token: getToken() ?? undefined })
    },
    [ensureSocket, send],
  )

  const leave = useCallback(() => {
    send({ type: WS_MESSAGE_TYPE.roomLeave })
    send({ type: WS_MESSAGE_TYPE.queueLeave })
  }, [send])

  const report = useCallback(
    (reason: import('../../shared/types').ReportReason, detail?: string) => {
      send({ type: WS_MESSAGE_TYPE.report, reason, detail })
    },
    [send],
  )

  const block = useCallback(() => {
    send({ type: WS_MESSAGE_TYPE.block })
  }, [send])

  const groupInvite = useCallback(
    (groupId: number, userId: number) => {
      send({ type: WS_MESSAGE_TYPE.groupInviteSend, groupId, userId })
    },
    [send],
  )

  const groupInviteAccept = useCallback(
    (inviteId: number) => {
      send({ type: WS_MESSAGE_TYPE.groupInviteAccept, inviteId })
    },
    [send],
  )

  const groupInviteDecline = useCallback(
    (inviteId: number) => {
      send({ type: WS_MESSAGE_TYPE.groupInviteDecline, inviteId })
    },
    [send],
  )

  const groupMatchCreate = useCallback(
    (visibility: GroupVisibility, preferences: MatchPreferences) => {
      ensureSocket()
      send({ type: 'group-match:create', visibility, preferences, token: getToken() ?? undefined })
    },
    [ensureSocket, send],
  )

  const groupMatchInvite = useCallback(
    (roomId: string, userId: number) => {
      send({ type: 'group-match:invite', roomId, userId, token: getToken() ?? undefined })
    },
    [send],
  )

  const groupMatchCreateAndInvite = useCallback(
    (visibility: GroupVisibility, preferences: MatchPreferences, userId?: number) => {
      ensureSocket()
      send({ type: 'group-match:create-and-invite', visibility, preferences, userId, token: getToken() ?? undefined })
    },
    [ensureSocket, send],
  )

  const groupMatchJoin = useCallback(
    (roomId: string) => {
      ensureSocket()
      send({ type: 'group-match:join', roomId, token: getToken() ?? undefined })
    },
    [ensureSocket, send],
  )

  const groupMatchStart = useCallback(
    (roomId: string) => {
      send({ type: 'group-match:start', roomId })
    },
    [send],
  )

  const groupMatchLeave = useCallback(
    () => {
      send({ type: 'group-match:leave' })
    },
    [send],
  )

  const invitationSend = useCallback(
    (userId: number, roomId: string) => {
      console.debug('[ws] invitationSend', { userId, roomId })
      send({ type: WS_MESSAGE_TYPE.invitationSend, userId, roomId })
    },
    [send],
  )

  const invitationAccept = useCallback(
    (invitationId: number, roomId: string) => {
      send({ type: WS_MESSAGE_TYPE.invitationAccept, invitationId, roomId })
    },
    [send],
  )

  const invitationDecline = useCallback(
    (invitationId: number) => {
      send({ type: WS_MESSAGE_TYPE.invitationDecline, invitationId })
    },
    [send],
  )

  useEffect(() => {
    ensureSocket()
    return () => {
      stopHeartbeat()
      stopReconnect()
      socket.current?.close()
      socket.current = null
    }
  }, [ensureSocket])

  // Re-authenticate when token changes (e.g. user logs in after WS is already open)
  useEffect(() => {
    const token = getToken()
    if (token && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: WS_MESSAGE_TYPE.wsAuth, token }))
    }
  }, [getToken()])

  return {
    send,
    sendSignal,
    join,
    next,
    leave,
    report,
    block,
    groupInvite,
    groupInviteAccept,
    groupInviteDecline,
    groupMatchCreate,
    groupMatchInvite,
    groupMatchCreateAndInvite,
    groupMatchJoin,
    groupMatchStart,
    groupMatchLeave,
    invitationSend,
    invitationAccept,
    invitationDecline,
    connected,
    socket,
  }
}

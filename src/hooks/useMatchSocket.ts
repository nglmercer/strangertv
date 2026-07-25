import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { getToken, wsUrl } from '../api'
import type { ClientMessage, GroupMessage, MatchPreferences, Message, PublicUser, RelationshipStatus, Role, ServerMessage } from '../../shared/types'
import { WS_MESSAGE_TYPE, TIMING_MS } from '../../shared/constants'

type Handlers = {
  onWaiting?: (position?: number, online?: number) => void
  onMatched?: (
    roomId: string,
    role: Role,
    meta?: { peerCountry?: string; peerEmail?: string; peerUserId?: number; sharedInterests?: string[]; relationship?: RelationshipStatus },
  ) => void
  onPeerLeft?: (reason?: string) => void
  onSignal?: (payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown }) => void
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
  onGroupInvite?: (inviteId: number, groupId: number, groupName: string, inviter: PublicUser) => void
  onGroupInviteAccepted?: (inviteId: number, groupId: number, userId: number) => void
  onGroupInviteDeclined?: (inviteId: number, groupId: number, userId: number) => void
}

export function useMatchSocket(handlers: Handlers) {
  const socket = useRef<WebSocket | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [connected, setConnected] = useState(false)
  const heartbeatTimer = useRef<number | null>(null)

  const stopHeartbeat = () => {
    if (heartbeatTimer.current != null) {
      window.clearInterval(heartbeatTimer.current)
      heartbeatTimer.current = null
    }
  }

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message))
    }
  }, [])

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
    }

    ws.onclose = () => {
      setConnected(false)
      stopHeartbeat()
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
          h.onSignal?.(msg.payload)
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
          h.onInvitation?.(msg.invitationId, msg.roomId, msg.inviter)
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

  useEffect(() => {
    ensureSocket()
    return () => {
      stopHeartbeat()
      socket.current?.close()
      socket.current = null
    }
  }, [ensureSocket])

  return { send, join, next, leave, report, block, groupInvite, groupInviteAccept, groupInviteDecline, connected, socket }
}

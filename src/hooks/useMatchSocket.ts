import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { getToken, wsUrl } from '../api'
import type { ClientMessage, MatchPreferences, RelationshipStatus, Role, ServerMessage } from '../../shared/types'
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

  useEffect(() => {
    // Open signaling early for stats/heartbeat and connection indicator
    ensureSocket()
    return () => {
      stopHeartbeat()
      socket.current?.close()
      socket.current = null
    }
  }, [ensureSocket])

  return { send, join, next, leave, report, block, connected, socket }
}

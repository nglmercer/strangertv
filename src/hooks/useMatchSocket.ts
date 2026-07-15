import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { getToken, wsUrl } from '../api'
import type { ClientMessage, MatchPreferences, ServerMessage } from '../../shared/types'

type Handlers = {
  onWaiting?: (position?: number, online?: number) => void
  onMatched?: (
    roomId: string,
    role: 'offerer' | 'answerer',
    meta?: { peerCountry?: string; sharedInterests?: string[] },
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
        send({ type: 'queue:heartbeat' })
      }, 12_000)
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
        case 'queue:waiting':
          h.onWaiting?.(msg.position, msg.online)
          break
        case 'room:matched':
          h.onMatched?.(msg.roomId, msg.role, {
            peerCountry: msg.peerCountry,
            sharedInterests: msg.sharedInterests,
          })
          break
        case 'room:peer-left':
          h.onPeerLeft?.(msg.reason)
          break
        case 'signal':
          h.onSignal?.(msg.payload)
          break
        case 'chat':
          h.onChat?.(msg.payload.text, msg.payload.time)
          break
        case 'stats':
          h.onStats?.(msg.online, msg.waiting)
          break
        case 'error':
          h.onError?.(msg.code, msg.message)
          break
        case 'report:ack':
          h.onReportAck?.()
          break
        case 'block:ack':
          h.onBlockAck?.()
          break
        case 'server:draining':
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
        type: 'queue:join',
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
      send({ type: 'room:next', preferences, token: getToken() ?? undefined })
    },
    [ensureSocket, send],
  )

  const leave = useCallback(() => {
    send({ type: 'room:leave' })
    send({ type: 'queue:leave' })
  }, [send])

  const report = useCallback(
    (reason: import('../../shared/types').ReportReason, detail?: string) => {
      send({ type: 'report', reason, detail })
    },
    [send],
  )

  const block = useCallback(() => {
    send({ type: 'block' })
  }, [send])

  useEffect(
    () => () => {
      stopHeartbeat()
      socket.current?.close()
      socket.current = null
    },
    [],
  )

  return { send, join, next, leave, report, block, connected, socket }
}

import { useEffect, useRef, useState } from 'preact/hooks'
import type { Messages } from '../../i18n'
import { activitiesApi, onActivityPresence, onActivityState } from '../../api'
import type { ActivitySession as Session } from '../../hooks/useActivities'
import { createActivityHost, type ActivityHost, type ActivityPresenceUser } from '../../activities/client'
import { userDisplayName } from './people'
import { Modal } from '../Modal'

/**
 * The open game: a sandboxed same-origin iframe plus the bridge between it
 * and the app socket. The game talks only postMessage; this side relays
 * moves onto the WebSocket and pushes relayed moves, rosters, and the end
 * signal back in. The launch code crosses exactly once per iframe load — a
 * reload re-joins (seat is idempotent) for a fresh single-use code.
 */
export function ActivitySession({
  t,
  session,
  currentUserId,
  socket,
  busy,
  onLeave,
  onEnd,
  onClose,
}: {
  t: Messages
  session: Session
  currentUserId: number
  socket: { activityState: (instanceId: number, state: unknown) => void } | null
  busy: boolean
  onLeave: () => Promise<void>
  onEnd: () => Promise<void>
  onClose: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<ActivityHost | null>(null)
  const [names, setNames] = useState<ActivityPresenceUser[]>([])
  const [failed, setFailed] = useState(false)
  const instanceId = session.instance.id

  // Latest callbacks for the bridge, which outlives any one render.
  const socketRef = useRef(socket)
  socketRef.current = socket
  const onLeaveRef = useRef(onLeave)
  onLeaveRef.current = onLeave
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  // Latest roster, mirrored into a ref so `ready` answers carry it even
  // when the fetch below resolves before the bridge exists.
  const namesRef = useRef<ActivityPresenceUser[]>([])
  const setRoster = (roster: ActivityPresenceUser[]) => {
    namesRef.current = roster
    setNames(roster)
  }

  // Initial roster so the header and the game agree before the first push.
  useEffect(() => {
    let live = true
    activitiesApi
      .show(instanceId)
      .then(({ participants }) => {
        if (!live) return
        const roster = participants.map((p) => ({ userId: p.userId, name: userDisplayName(p.user) }))
        setRoster(roster)
        hostRef.current?.pushPresence(roster)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [instanceId])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const host = createActivityHost(frame)
    if (!host) return
    hostRef.current = host
    let inited = false

    const offReady = host.onReady(() => {
      // The first `ready` takes the code from join(); every later one mints
      // a fresh code. A retry (game booted before this listener attached)
      // looks exactly like a reload (new document, spent code), and join is
      // seat-idempotent — while outstanding codes are never revoked early,
      // so every delivered init stays spendable.
      //
      // Every answer also carries the current roster: presence broadcasts
      // race the iframe boot (a push to a not-yet-listening game is lost),
      // so the roster rides along instead of depending on push timing.
      if (!inited) {
        inited = true
        host.init(session.code, instanceId)
        host.pushPresence(namesRef.current)
        return
      }
      activitiesApi
        .join(instanceId)
        .then(({ code }) => {
          host.init(code, instanceId)
          host.pushPresence(namesRef.current)
        })
        .catch(() => setFailed(true))
    })
    const offPublish = host.onPublish((state) => {
      socketRef.current?.activityState(instanceId, state)
    })
    const offLeave = host.onLeave(() => {
      void onLeaveRef.current()
    })
    const offState = onActivityState((id, userId, state) => {
      if (id === instanceId) host.pushState(userId, state)
    })
    const offPresence = onActivityPresence((id, participants) => {
      if (id !== instanceId) return
      const roster = participants.map((p) => ({ userId: p.userId, name: userDisplayName(p.user) }))
      setRoster(roster)
      host.pushPresence(roster)
    })
    // No ended subscription here: `useActivities` closes the session when
    // its game ends, which unmounts this modal (and its iframe) directly.
    return () => {
      offReady()
      offPublish()
      offLeave()
      offState()
      offPresence()
      host.dispose()
      hostRef.current = null
    }
    // The session identity is fixed for the modal's lifetime; the code is
    // consumed via ref-safe callbacks above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  const isHost = session.instance.createdBy === currentUserId

  return (
    <Modal onClose={onClose} className="modal social-modal activity-session-modal" labelledBy="activity-session-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="activity-session-title">{session.activity.name}</h2>
      <p class="people-note">
        {names.length > 0 ? names.map((n) => n.name).join(', ') : t.waitingForPlayers}
      </p>

      <div class="activity-frame-wrap">
        <iframe
          ref={frameRef}
          class="activity-frame"
          title={session.activity.name}
          src={session.activity.entryUrl}
          sandbox="allow-scripts allow-same-origin"
        />
      </div>

      {failed && <p class="people-note error">{t.genericError}</p>}

      <div class="activity-session-actions">
        {isHost && (
          <button type="button" class="social-btn danger" disabled={busy} onClick={() => void onEndRef.current()}>
            {t.endGame}
          </button>
        )}
        <button type="button" class="social-btn" disabled={busy} onClick={() => void onLeaveRef.current()}>
          {t.leaveGame}
        </button>
      </div>
    </Modal>
  )
}

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { ClientMessage, Locale, MatchPreferences, ReportReason } from '../shared/types'
import {
  authApi,
  clearSession,
  fetchHealth,
  getStoredUser,
  getToken,
  loadPrefs,
  savePrefs,
  socialApi,
  type PublicUser,
} from './api'
import { AuthModal } from './components/AuthModal'
import { PreferencesModal } from './components/PreferencesModal'
import { ProfileModal } from './components/ProfileModal'
import { ReportModal } from './components/ReportModal'
import { SettingsModal } from './components/SettingsModal'
import { StartMatchModal } from './components/StartMatchModal'
import { StaticPage, type PageId } from './components/StaticPages'
import { useMatchSocket } from './hooks/useMatchSocket'
import { useMedia } from './hooks/useMedia'
import { useWebRTC } from './hooks/useWebRTC'
import { detectLocale, t as translate } from './i18n'

type ChatMessage = { text: string; mine: boolean; time: string }

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale)
  const tr = translate(locale)
  const [prefs, setPrefsState] = useState<MatchPreferences>(loadPrefs)
  const setPrefs = (p: MatchPreferences) => {
    setPrefsState(p)
    savePrefs(p)
  }

  const [finding, setFinding] = useState(false)
  const [matched, setMatched] = useState(false)
  const [status, setStatus] = useState<string>(() => translate(detectLocale()).ready)
  const [queuePos, setQueuePos] = useState<number | undefined>()
  const [online, setOnline] = useState(0)
  const [waitingCount, setWaitingCount] = useState(0)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [streamTick, setStreamTick] = useState(0)

  const [profileNeeded, setProfileNeeded] = useState(
    () => localStorage.getItem('stranger-profile-complete') !== 'true',
  )
  const [showStart, setShowStart] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [auth, setAuth] = useState(false)
  const [settings, setSettings] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [page, setPage] = useState<PageId>(null)
  const [user, setUser] = useState<PublicUser | null>(getStoredUser)

  const localVideo = useRef<HTMLVideoElement>(null)
  const remoteVideo = useRef<HTMLVideoElement>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const media = useMedia()
  const signalOut = useRef<(payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown }) => void>(() => undefined)

  const onSignalOut = useCallback((payload: { kind: 'offer' | 'answer' | 'candidate'; data: unknown }) => {
    signalOut.current(payload)
  }, [])

  const webrtc = useWebRTC(onSignalOut)
  const webrtcRef = useRef(webrtc)
  webrtcRef.current = webrtc
  const mediaRef = useRef(media)
  mediaRef.current = media
  const trRef = useRef(tr)
  trRef.current = tr

  const match = useMatchSocket({
    onWaiting: (position, onl) => {
      setStatus(trRef.current.finding)
      setQueuePos(position)
      if (onl != null) setOnline(onl)
      setMatched(false)
      webrtcRef.current.clear()
      if (remoteVideo.current) remoteVideo.current.srcObject = null
    },
    onMatched: async (id, role) => {
      setRoomId(id)
      setMatched(true)
      setStatus(trRef.current.connecting)
      setQueuePos(undefined)
      const stream = mediaRef.current.streamRef.current
      if (!stream) return
      await webrtcRef.current.createPeer(stream, remoteVideo.current, role === 'offerer')
    },
    onPeerLeft: () => {
      webrtcRef.current.clear()
      if (remoteVideo.current) remoteVideo.current.srcObject = null
      setMatched(false)
      setRoomId(null)
      setFinding(false)
      setStatus(trRef.current.peerLeft)
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
      setStatus(message)
      setFinding(false)
    },
    onReportAck: () => {
      webrtcRef.current.clear()
      setMatched(false)
      setFinding(false)
      setRoomId(null)
      setStatus(trRef.current.reportThanks)
    },
  })

  signalOut.current = (payload) => match.send({ type: 'signal', payload })

  useEffect(() => {
    if (getToken()) {
      void authApi
        .me()
        .then((r) => setUser(r.user))
        .catch(() => {
          clearSession()
          setUser(null)
        })
    }
    void fetchHealth().then((h) => {
      if (h.ok) {
        setOnline(h.online)
        setWaitingCount(h.waiting)
      }
    })
    const iv = window.setInterval(() => {
      void fetchHealth().then((h) => {
        if (h.ok) {
          setOnline(h.online)
          setWaitingCount(h.waiting)
        }
      })
    }, 20_000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (localVideo.current && media.streamRef.current) {
      localVideo.current.srcObject = media.streamRef.current
    }
  }, [finding, showStart, streamTick])

  const beginMatch = async () => {
    try {
      const stream = await media.ensureStream()
      setStreamTick((n) => n + 1)
      if (localVideo.current) localVideo.current.srcObject = stream
      setChat([])
      setFinding(true)
      setMatched(false)
      setStatus(tr.finding)
      match.join(prefsRef.current)
      setShowStart(false)
    } catch {
      setStatus(tr.cameraNeeded)
      setFinding(false)
    }
  }

  const onStartClick = () => {
    if (profileNeeded) return
    setShowStart(true)
  }

  const stop = () => {
    match.leave()
    webrtc.clear()
    if (remoteVideo.current) remoteVideo.current.srcObject = null
    setFinding(false)
    setMatched(false)
    setRoomId(null)
    setQueuePos(undefined)
    setStatus(tr.ready)
  }

  const next = () => {
    webrtc.clear()
    if (remoteVideo.current) remoteVideo.current.srcObject = null
    setChat([])
    setMatched(false)
    setStatus(tr.finding)
    setFinding(true)
    match.next(prefsRef.current)
  }

  const sendChat = (event: Event) => {
    event.preventDefault()
    const text = chatText.trim().slice(0, 500)
    if (!text || !matched) return
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    setChat((m) => [...m, { text, time, mine: true }])
    match.send({ type: 'chat', payload: { text, time } } as ClientMessage)
    setChatText('')
  }

  const genderEmoji =
    prefs.gender === 'male' ? '👨' : prefs.gender === 'female' ? '👩' : prefs.gender === 'other' ? '🧑' : '🌐'
  const lookingLabel =
    prefs.lookingFor === 'male'
      ? tr.male
      : prefs.lookingFor === 'female'
        ? tr.female
        : prefs.lookingFor === 'other'
          ? tr.other
          : tr.everyone

  const qualityLabel =
    webrtc.quality === 'good'
      ? tr.quality.good
      : webrtc.quality === 'poor'
        ? tr.quality.poor
        : webrtc.quality === 'failed'
          ? tr.quality.failed
          : webrtc.quality === 'connecting'
            ? tr.quality.connecting
            : ''

  return (
    <main class="app">
      <header class="topbar">
        <a class="brand" href="/">
          ✦ {tr.brand}
        </a>
        <div class="online" aria-live="polite">
          <i /> {tr.live}
          <span class="stats">
            · {online} {tr.online} · {waitingCount} {tr.waiting}
          </span>
        </div>
        <div class="header-actions">
          <button type="button" class="sign ghost" onClick={() => setPreferences(true)}>
            {tr.preferences}
          </button>
          {user && (
            <button type="button" class="sign ghost" onClick={() => setSettings(true)}>
              {tr.settings}
            </button>
          )}
          <button
            type="button"
            class="sign"
            onClick={async () => {
              if (user) {
                try {
                  await authApi.logout()
                } catch {
                  /* ignore */
                }
                clearSession()
                setUser(null)
              } else setAuth(true)
            }}
          >
            {user ? tr.signOut : tr.signIn}
          </button>
        </div>
      </header>

      <section class="stage">
        <div class={`finder-state ${finding ? 'active' : ''}`} role="status" aria-live="polite">
          <span class="finder-orb">
            <i />
            <i />
            <i />
          </span>
          <strong>{finding ? status : tr.ready}</strong>
          <small>
            {finding
              ? queuePos
                ? `${tr.position} #${queuePos}`
                : qualityLabel || tr.readySub
              : tr.readySub}
          </small>
        </div>

        <div class="video-grid">
          <article class={`video remote ${finding ? 'is-finding' : ''} ${webrtc.hasRemote ? 'has-stream' : ''}`}>
            <video ref={remoteVideo} autoplay playsinline />
            {!webrtc.hasRemote && (
              <>
                <div class="tv-logo">
                  <strong>Ome</strong>
                  <b>TV</b>
                  <i />
                  <i />
                </div>
                <div class="empty">
                  <h2>{finding ? status : tr.ready}</h2>
                  <p>{finding ? tr.readySub : tr.findStranger}</p>
                </div>
              </>
            )}
            <span class="label">Stranger{qualityLabel ? ` · ${qualityLabel}` : ''}</span>
          </article>
          <article class="video local">
            <video ref={localVideo} autoplay playsinline muted />
            {!media.streamRef.current && <div class="local-empty">{tr.previewCam}</div>}
            <span class="label">You</span>
          </article>
        </div>

        {(finding || matched) && (
          <div class="call-bar" role="toolbar" aria-label="Call controls">
            <button
              type="button"
              class="call-btn"
              onClick={() => media.setMutedTrack(!media.muted)}
              aria-pressed={media.muted}
            >
              {media.muted ? tr.unmute : tr.mute}
            </button>
            <button
              type="button"
              class="call-btn"
              onClick={() => media.setCameraTrack(!media.cameraOn)}
              aria-pressed={!media.cameraOn}
            >
              {media.cameraOn ? tr.camOff : tr.camOn}
            </button>
            <button type="button" class="call-btn next-btn" onClick={next} disabled={!finding}>
              {tr.next}
            </button>
            <button type="button" class="call-btn danger" onClick={stop}>
              {tr.stop}
            </button>
            <button type="button" class="call-btn" onClick={() => setReportOpen(true)} disabled={!matched}>
              {tr.report}
            </button>
          </div>
        )}
      </section>

      <section class="dashboard">
        <div class="deck">
          <button type="button" class="deck-card start" onClick={onStartClick} disabled={finding}>
            <span>{tr.start}</span>
            <small>{tr.findStranger}</small>
          </button>
          <button type="button" class="deck-card stop" onClick={stop} disabled={!finding}>
            <span>{tr.stop}</span>
            <small>{tr.endConversation}</small>
          </button>
          <button type="button" class="deck-card" onClick={() => setPreferences(true)}>
            <span>
              {tr.country} <b>{prefs.country === 'any' ? '🌐' : prefs.country}</b>
            </span>
            <small>{prefs.country}</small>
          </button>
          <button type="button" class="deck-card" onClick={() => setPreferences(true)}>
            <span>
              {tr.gender} <b>{genderEmoji}</b>
            </span>
            <small>{lookingLabel}</small>
          </button>
        </div>

        <div class="chat-box">
          <div class="notice">
            <span class="notice-icon">▣</span>
            <p>
              {tr.notice}
              <br />
              <button type="button" class="linkish" onClick={() => setPage('rules')}>
                {tr.rules}
              </button>
              {' · '}
              <button type="button" class="linkish" onClick={() => setPage('safety')}>
                ⚠ {tr.safety}
              </button>
            </p>
          </div>
          <div class="messages" aria-live="polite">
            {chat.length === 0 && <span class="chat-placeholder">{tr.chatPlaceholder}</span>}
            {chat.map((message) => (
              <div class={`message ${message.mine ? 'mine' : ''}`}>
                <span>{message.text}</span>
                <small>{message.time}</small>
              </div>
            ))}
          </div>
          <form class="chat-input" onSubmit={sendChat}>
            <input
              value={chatText}
              onInput={(e) => setChatText(e.currentTarget.value)}
              disabled={!matched}
              placeholder={matched ? tr.writeMessage : tr.startToChat}
              maxLength={500}
            />
            <button type="submit" disabled={!matched || !chatText.trim()} aria-label="Send">
              ☺
            </button>
          </form>
        </div>
      </section>

      <footer class="footer">
        <span>
          {tr.footerAge}
          {' · '}
          <button type="button" class="linkish" onClick={() => setPage('privacy')}>
            {tr.privacy}
          </button>
          {' · '}
          <button type="button" class="linkish" onClick={() => setPage('terms')}>
            {tr.terms}
          </button>
        </span>
        <span>{user ? `${tr.signedInAs} ${user.email}` : tr.notRecorded}</span>
      </footer>

      {profileNeeded && <ProfileModal t={tr} onComplete={() => setProfileNeeded(false)} />}
      {showStart && (
        <StartMatchModal
          t={tr}
          prefs={prefs}
          setPrefs={setPrefs}
          stream={media.streamRef.current}
          ensureStream={async () => {
            const s = await media.ensureStream()
            setStreamTick((n) => n + 1)
            return s
          }}
          devices={media.devices}
          videoId={media.videoId}
          audioId={media.audioId}
          setVideoId={(id) => {
            media.setVideoId(id)
            void media.ensureStream().then((s) => {
              setStreamTick((n) => n + 1)
              if (localVideo.current) localVideo.current.srcObject = s
              webrtc.replaceTracks(s)
            })
          }}
          setAudioId={(id) => {
            media.setAudioId(id)
            void media.ensureStream().then((s) => {
              setStreamTick((n) => n + 1)
              if (localVideo.current) localVideo.current.srcObject = s
              webrtc.replaceTracks(s)
            })
          }}
          onConfirm={() => void beginMatch()}
          onClose={() => setShowStart(false)}
        />
      )}
      {preferences && (
        <PreferencesModal
          t={tr}
          prefs={prefs}
          locale={locale}
          setPrefs={setPrefs}
          setLocale={setLocale}
          onClose={() => {
            setPreferences(false)
            if (user) void authApi.savePreferences(prefs).catch(() => undefined)
          }}
        />
      )}
      {auth && (
        <AuthModal
          t={tr}
          onClose={() => setAuth(false)}
          onAuth={(u) => {
            setUser(u)
            setProfileNeeded(false)
          }}
        />
      )}
      {settings && user && (
        <SettingsModal t={tr} user={user} onClose={() => setSettings(false)} onDeleted={() => setUser(null)} />
      )}
      {reportOpen && (
        <ReportModal
          t={tr}
          onClose={() => setReportOpen(false)}
          onSubmit={(reason: ReportReason, detail: string) => {
            match.report(reason, detail)
            void socialApi.report(reason, detail, roomId ?? undefined).catch(() => undefined)
            setReportOpen(false)
          }}
        />
      )}
      <StaticPage page={page} t={tr} onClose={() => setPage(null)} />
    </main>
  )
}

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
import { OfflineBanner } from './components/OfflineBanner'
import { RatingPrompt } from './components/RatingPrompt'
import { notifyMatch, playMatchSound } from './utils/notify'

type ChatMessage = { text: string; mine: boolean; time: string }

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

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
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem('stranger-auto-next') === '1')
  const autoNextRef = useRef(autoNext)
  autoNextRef.current = autoNext
  const [status, setStatus] = useState<string>(() => translate(detectLocale()).ready)
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
  const [appVersion, setAppVersion] = useState('')
  const [longWait, setLongWait] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const matchedAt = useRef<number | null>(null)
  const waitingSince = useRef<number | null>(null)

  const [profileNeeded, setProfileNeeded] = useState(
    () => localStorage.getItem('stranger-profile-complete') !== 'true',
  )
  const [showStart, setShowStart] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [auth, setAuth] = useState(false)
  const [resetTokenFromUrl, setResetTokenFromUrl] = useState('')
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
      setStatus(trRef.current.connecting)
      setQueuePos(undefined)
      setSharedInterests(meta?.sharedInterests ?? [])
      setPeerCountry(meta?.peerCountry && meta.peerCountry !== 'any' ? meta.peerCountry : '')
      if (localStorage.getItem('stranger-match-sound') !== '0') playMatchSound()
      if (localStorage.getItem('stranger-match-notify') === '1') {
        notifyMatch(trRef.current.brand, trRef.current.connecting)
      }
      const stream = mediaRef.current.streamRef.current
      if (!stream) return
      await webrtcRef.current.createPeer(stream, remoteVideo.current, role === 'offerer')
    },
    onPeerLeft: () => {
      const endedRoom = roomIdRef.current
      webrtcRef.current.clear()
      if (remoteVideo.current) remoteVideo.current.srcObject = null
      setMatched(false)
      setRoomId(null)
      setSharedInterests([])
      setPeerCountry('')
      matchedAt.current = null
      if (endedRoom && callSecondsRef.current >= 5 && !autoNextRef.current) {
        setRateRoomId(endedRoom)
      }
      if (autoNextRef.current) {
        setFinding(true)
        setStatus(trRef.current.requeueing)
        setChat([])
        window.setTimeout(() => matchRef.current?.next(prefsRef.current), 400)
      } else {
        setFinding(false)
        setStatus(trRef.current.peerLeft)
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
    onBlockAck: () => {
      webrtcRef.current.clear()
      setMatched(false)
      setFinding(false)
      setRoomId(null)
      setSharedInterests([])
      setPeerCountry('')
      setStatus(trRef.current.blocked)
    },
    onDraining: (message) => {
      webrtcRef.current.clear()
      setFinding(false)
      setMatched(false)
      setStatus(message || trRef.current.draining)
      // Auto-retry match after drain window if user was active
      if (findingRef.current || matchedRef.current) {
        window.setTimeout(() => {
          setStatus(trRef.current.reconnecting)
          void beginMatchRef.current?.()
        }, 10_000)
      }
    },
  })

  const findingRef = useRef(finding)
  findingRef.current = finding
  const matchedRef = useRef(matched)
  matchedRef.current = matched

  const matchRef = useRef(match)
  matchRef.current = match
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId
  const callSecondsRef = useRef(0)

  signalOut.current = (payload) => match.send({ type: 'signal', payload })

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
      setLongWait(Date.now() - waitingSince.current > 45_000)
    }, 5000)
    return () => clearInterval(iv)
  }, [finding, matched])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat])

  // WebRTC quality telemetry (throttled by quality changes)
  useEffect(() => {
    if (!matched || webrtc.quality === 'idle') return
    match.send({
      type: 'telemetry:quality',
      roomId: roomId ?? undefined,
      quality: webrtc.quality,
    })
  }, [webrtc.quality, matched, roomId, match])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const reset = params.get('reset')
    if (reset) {
      setResetTokenFromUrl(reset)
      setAuth(true)
      history.replaceState({}, '', location.pathname)
    }
    const verify = params.get('verify')
    if (verify) {
      void authApi
        .verifyEmail(verify)
        .then(() => {
          setStatus(translate(detectLocale()).emailVerified)
          history.replaceState({}, '', location.pathname)
          if (getToken()) {
            void authApi.me().then((r) => setUser(r.user)).catch(() => undefined)
          }
        })
        .catch(() => setStatus(translate(detectLocale()).emailVerifyFailed))
    }
    if (getToken()) {
      void authApi
        .refresh()
        .then((r) => {
          localStorage.setItem('stranger-token', r.token)
          localStorage.setItem('stranger-user', JSON.stringify(r.user))
          setUser(r.user)
        })
        .catch(() =>
          authApi
            .me()
            .then((r) => setUser(r.user))
            .catch(() => {
              clearSession()
              setUser(null)
            }),
        )
    }
    void fetchHealth().then((h) => {
      if (h.ok) {
        setOnline(h.online)
        setWaitingCount(h.waiting)
        if ('version' in h && typeof (h as { version?: string }).version === 'string') {
          setAppVersion((h as { version: string }).version)
        }
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
  const beginMatchRef = useRef(beginMatch)
  beginMatchRef.current = beginMatch

  const onStartClick = () => {
    if (profileNeeded) return
    setShowStart(true)
  }

  const stop = () => {
    const endedRoom = roomId
    const duration = callSecondsRef.current
    match.leave()
    webrtc.clear()
    if (remoteVideo.current) remoteVideo.current.srcObject = null
    setFinding(false)
    setMatched(false)
    setRoomId(null)
    setSharedInterests([])
    setPeerCountry('')
    setQueuePos(undefined)
    matchedAt.current = null
    setStatus(tr.ready)
    if (endedRoom && duration >= 5) setRateRoomId(endedRoom)
  }

  const next = () => {
    const endedRoom = roomId
    const duration = callSecondsRef.current
    webrtc.clear()
    if (remoteVideo.current) remoteVideo.current.srcObject = null
    setChat([])
    setMatched(false)
    setSharedInterests([])
    setPeerCountry('')
    matchedAt.current = null
    setStatus(tr.finding)
    setFinding(true)
    match.next(prefsRef.current)
    if (endedRoom && duration >= 5) setRateRoomId(endedRoom)
  }

  const stopRef = useRef(stop)
  stopRef.current = stop
  const nextRef = useRef(next)
  nextRef.current = next

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!findingRef.current && !matchedRef.current) return
      const key = e.key.toLowerCase()
      if (key === 'm') {
        e.preventDefault()
        media.setMutedTrack(!media.muted)
      } else if (key === 'c') {
        e.preventDefault()
        media.setCameraTrack(!media.cameraOn)
      } else if (key === 'n' && findingRef.current) {
        e.preventDefault()
        nextRef.current()
      } else if (key === 'escape') {
        e.preventDefault()
        stopRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [media])

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
      <OfflineBanner label={tr.offline} />
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
              ? longWait
                ? tr.longWait
                : queuePos
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
            <span class="label">
              Stranger
              {peerCountry ? ` · ${peerCountry}` : ''}
              {matched && callSeconds > 0 ? ` · ${formatDuration(callSeconds)}` : ''}
              {qualityLabel ? ` · ${qualityLabel}` : ''}
            </span>
            {sharedInterests.length > 0 && matched && (
              <div class="interest-badge" aria-label={tr.sharedInterests}>
                <small>{tr.sharedInterests}</small>
                <div class="chips tight">
                  {sharedInterests.map((tag) => (
                    <span class="chip on">{tag}</span>
                  ))}
                </div>
              </div>
            )}
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
            <button
              type="button"
              class="call-btn danger"
              disabled={!matched || !user}
              title={!user ? 'Sign in to block' : undefined}
              onClick={() => match.block()}
            >
              {tr.blockPeer}
            </button>
            {webrtc.quality === 'failed' && (
              <button type="button" class="call-btn next-btn" onClick={() => void webrtc.restartIce()}>
                {tr.retryIce}
              </button>
            )}
            <button
              type="button"
              class="call-btn"
              onClick={() => {
                const el = document.querySelector('.stage')
                if (!el) return
                if (!document.fullscreenElement) void el.requestFullscreen?.()
                else void document.exitFullscreen?.()
              }}
            >
              {tr.fullscreen}
            </button>
          </div>
        )}
        {webrtc.quality === 'failed' && matched && (
          <p class="stage-error" role="alert">
            {tr.connectionFailed}
          </p>
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
          <button
            type="button"
            class={`deck-card ${autoNext ? 'auto-on' : ''}`}
            onClick={() => {
              const nextVal = !autoNext
              setAutoNext(nextVal)
              localStorage.setItem('stranger-auto-next', nextVal ? '1' : '0')
            }}
            aria-pressed={autoNext}
          >
            <span>{tr.autoNext}</span>
            <small>{autoNext ? tr.autoNextOn : tr.autoNextOff}</small>
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
            <div ref={messagesEnd} />
          </div>
          {(finding || matched) && <p class="shortcuts-hint">{tr.shortcuts}</p>}
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
          {appVersion ? ` · ${tr.version}${appVersion}` : ''}
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
          initialResetToken={resetTokenFromUrl || undefined}
          onClose={() => {
            setAuth(false)
            setResetTokenFromUrl('')
          }}
          onAuth={(u) => {
            setUser(u)
            setProfileNeeded(false)
          }}
        />
      )}
      {settings && user && (
        <SettingsModal
          t={tr}
          user={user}
          onClose={() => setSettings(false)}
          onDeleted={() => setUser(null)}
          onUserUpdate={setUser}
        />
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
      {rateRoomId && (
        <RatingPrompt
          t={tr}
          onSkip={() => setRateRoomId(null)}
          onRate={(score) => {
            void socialApi.rate(score, rateRoomId).catch(() => undefined)
            setRateRoomId(null)
          }}
        />
      )}
      <StaticPage page={page} t={tr} onClose={() => setPage(null)} />
    </main>
  )
}

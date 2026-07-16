import { useCallback, useState } from 'preact/hooks'
import type { Locale, MatchPreferences, ReportReason } from '../shared/types'
import { PREFS_TAB, PrefsTab, STORAGE_KEYS, GENDER } from '../shared/constants'
import { authApi, clearSession, getStoredUser, loadPrefs, savePrefs, socialApi, type PublicUser } from './api'
import { AppFooter } from './components/AppFooter'
import { AppModals } from './components/AppModals'
import { CallBar } from './components/CallBar'
import { ChatPanel } from './components/ChatPanel'
import { ControlDeck } from './components/ControlDeck'
import { OfflineBanner } from './components/OfflineBanner'
import type { PageId } from './components/StaticPages'
import { TopBar } from './components/TopBar'
import { VideoStage } from './components/VideoStage'
import { useCallKeyboard } from './hooks/useCallKeyboard'
import { useMatchSession } from './hooks/useMatchSession'
import { useSessionBootstrap } from './hooks/useSessionBootstrap'
import { detectLocale, t as translate } from './i18n'
import {
  applyUserToClient,
  canQuickStart,
  isAgeGateComplete,
} from './utils/clientStorage'

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale)
  const tr = translate(locale)
  const [prefs, setPrefsState] = useState<MatchPreferences>(loadPrefs)
  const setPrefs = (p: MatchPreferences) => {
    setPrefsState(p)
    savePrefs(p)
  }

  const [autoNext, setAutoNext] = useState(() => localStorage.getItem(STORAGE_KEYS.autoNext) === '1')
  const [status, setStatus] = useState(() => translate(detectLocale()).ready)

  const [showStart, setShowStart] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [prefsTab, setPrefsTab] = useState<PrefsTab | undefined>(undefined)
  const [auth, setAuth] = useState(false)
  const [resetTokenFromUrl, setResetTokenFromUrl] = useState('')
  const [settings, setSettings] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [page, setPage] = useState<PageId>(null)
  const [user, setUser] = useState<PublicUser | null>(getStoredUser)
  const [profileNeeded, setProfileNeeded] = useState(() => {
    const stored = getStoredUser()
    if (stored) {
      const applied = applyUserToClient(stored)
      return !applied.profileComplete
    }
    return !isAgeGateComplete()
  })

  const applyUser = useCallback((u: PublicUser | null) => {
    setUser(u)
    if (!u) {
      setProfileNeeded(!isAgeGateComplete())
      return
    }
    const applied = applyUserToClient(u)
    setProfileNeeded(!applied.profileComplete)
    if (applied.prefs) {
      setPrefsState(applied.prefs)
      savePrefs(applied.prefs)
    }
  }, [])

  const session = useMatchSession({
    tr,
    prefs,
    autoNext,
    onStatus: setStatus,
  })

  const { appVersion } = useSessionBootstrap({
    setUser: applyUser,
    setAuth,
    setResetToken: setResetTokenFromUrl,
    setStatus,
    setOnline: session.setOnline,
    setWaitingCount: session.setWaitingCount,
  })

  useCallKeyboard({
    active: session.finding || session.matched,
    muted: session.media.muted,
    cameraOn: session.media.cameraOn,
    setMuted: session.media.setMutedTrack,
    setCamera: session.media.setCameraTrack,
    onNext: session.next,
    onStop: session.stop,
    canNext: session.finding,
  })

  const onStartClick = () => {
    if (profileNeeded) return
    if (canQuickStart()) {
      void session.beginMatch().then((ok) => {
        // Camera busy / denied after first-time setup: open Devices tab.
        if (!ok) {
          setPrefsTab(PREFS_TAB.devices)
          setPreferences(true)
        }
      })
      return
    }
    setShowStart(true)
  }

  const onAuthClick = useCallback(async () => {
    if (user) {
      try {
        await authApi.logout()
      } catch {
        /* ignore */
      }
      clearSession()
      applyUser(null)
    } else setAuth(true)
  }, [user, applyUser])

  const onDeviceChange = useCallback(
    (kind: 'video' | 'audio', id: string) => {
      void session.changeDevice(kind, id).catch(() => undefined)
    },
    [session],
  )

  const onReport = useCallback(
    (reason: ReportReason, detail: string) => {
      session.match.report(reason, detail)
      void socialApi.report(reason, detail, session.roomId ?? undefined).catch(() => undefined)
      setReportOpen(false)
    },
    [session],
  )

  const genderEmoji =
    prefs.gender === GENDER.male ? '👨' : prefs.gender === GENDER.female ? '👩' : prefs.gender === GENDER.other ? '🧑' : '🌐'
  const lookingLabel =
    prefs.lookingFor === GENDER.male
      ? tr.male
      : prefs.lookingFor === GENDER.female
        ? tr.female
        : prefs.lookingFor === GENDER.other
          ? tr.other
          : tr.everyone

  return (
    <main class="app">
      <OfflineBanner label={tr.offline} />
      <TopBar
        t={tr}
        online={session.online}
        waitingCount={session.waitingCount}
        signalOk={session.match.connected}
        user={user}
        onPreferences={() => {
          setPrefsTab(undefined)
          setPreferences(true)
        }}
        onSettings={() => setSettings(true)}
        onAuthClick={() => void onAuthClick()}
      />

      <div class="stage-wrap">
        <VideoStage
          t={tr}
          finding={session.finding}
          matched={session.matched}
          status={status}
          longWait={session.longWait}
          queuePos={session.queuePos}
          quality={session.webrtc.quality}
          linkStats={session.webrtc.linkStats}
          hasRemote={session.webrtc.hasRemote}
          peerCountry={session.peerCountry}
          callSeconds={session.callSeconds}
          sharedInterests={session.sharedInterests}
          localVideo={session.localVideo}
          remoteVideo={session.remoteVideo}
          hasLocalStream={Boolean(session.media.streamRef.current)}
        />
        <CallBar
          t={tr}
          finding={session.finding}
          matched={session.matched}
          muted={session.media.muted}
          cameraOn={session.media.cameraOn}
          quality={session.webrtc.quality}
          canBlock={Boolean(user)}
          onMute={() => session.media.setMutedTrack(!session.media.muted)}
          onCamera={() => session.media.setCameraTrack(!session.media.cameraOn)}
          onNext={session.next}
          onStop={session.stop}
          onReport={() => setReportOpen(true)}
          onBlock={() => session.match.block()}
          onRetryIce={() => void session.webrtc.restartIce()}
          onFullscreen={() => {
            const el = document.querySelector('.stage')
            if (!el) return
            if (!document.fullscreenElement) void el.requestFullscreen?.()
            else void document.exitFullscreen?.()
          }}
        />
      </div>

      <section class="dashboard">
        <ControlDeck
          t={tr}
          prefs={prefs}
          finding={session.finding}
          autoNext={autoNext}
          genderEmoji={genderEmoji}
          lookingLabel={lookingLabel}
          onStart={onStartClick}
          onStop={session.stop}
          onOpenPrefs={() => {
            setPrefsTab(PREFS_TAB.match)
            setPreferences(true)
          }}
          onToggleAutoNext={() => {
            const nextVal = !autoNext
            setAutoNext(nextVal)
            localStorage.setItem(STORAGE_KEYS.autoNext, nextVal ? '1' : '0')
          }}
        />
        <ChatPanel
          t={tr}
          chat={session.chat}
          chatText={session.chatText}
          setChatText={session.setChatText}
          matched={session.matched}
          finding={session.finding}
          messagesEnd={session.messagesEnd}
          onSend={session.sendChat}
          onOpenPage={setPage}
        />
      </section>

      <AppFooter
        t={tr}
        userEmail={user?.email ?? null}
        appVersion={appVersion}
        onOpenPage={setPage}
      />

      <AppModals
        t={tr}
        locale={locale}
        prefs={prefs}
        setPrefs={setPrefs}
        setLocale={setLocale}
        user={user}
        setUser={applyUser}
        profileNeeded={profileNeeded}
        setProfileNeeded={setProfileNeeded}
        showStart={showStart}
        setShowStart={setShowStart}
        preferences={preferences}
        setPreferences={(v) => {
          setPreferences(v)
          if (!v) setPrefsTab(undefined)
        }}
        auth={auth}
        setAuth={setAuth}
        resetTokenFromUrl={resetTokenFromUrl}
        setResetTokenFromUrl={setResetTokenFromUrl}
        settings={settings}
        setSettings={setSettings}
        reportOpen={reportOpen}
        setReportOpen={setReportOpen}
        rateRoomId={session.rateRoomId}
        setRateRoomId={session.setRateRoomId}
        page={page}
        setPage={setPage}
        prefsInitialTab={prefsTab}
        media={{
          stream: session.media.streamRef.current,
          streamVersion: session.media.streamVersion,
          devices: session.media.devices,
          videoId: session.media.videoId,
          audioId: session.media.audioId,
          errorCode: session.media.errorCode,
          acquiring: session.media.acquiring,
          refreshDevices: session.media.refreshDevices,
          ensureStream: async () => {
            const s = await session.media.ensureStream()
            session.setStreamTick((n) => n + 1)
            if (session.localVideo.current) session.localVideo.current.srcObject = s
            session.webrtc.replaceTracks(s)
            return s
          },
        }}
        onBeginMatch={() => {
          void session.beginMatch().then((ok) => {
            if (ok) setShowStart(false)
          })
        }}
        onReport={onReport}
        onDeviceChange={onDeviceChange}
      />
    </main>
  )
}

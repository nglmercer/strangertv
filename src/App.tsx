import { useCallback, useEffect, useState } from 'preact/hooks'
import { Router, route } from 'preact-router'
import type { Locale, MatchPreferences, PublicUser as SharedPublicUser, ReportReason } from '../shared/types'
import { PREFS_TAB, PrefsTab, GENDER, STORAGE_KEYS } from '../shared/constants'
//import { getFlag, setFlag } from './utils/storage'
import { mergePrefs } from './utils/sharePrefs'
import { authApi, clearSession, followsApi, friendsApi, getStoredUser, loadPrefs, savePrefs, socialApi, emitGroupMessage, type PublicUser } from './api'
import { AppModals } from './components/AppModals'
import { CallBar } from './components/CallBar'
import { ChatPanel } from './components/ChatPanel'
import { ControlDeck } from './components/ControlDeck'
import { FriendManager } from './components/FriendManager'
import { OfflineBanner } from './components/OfflineBanner'
import type { PageId } from './components/StaticPages'
import { VideoStage } from './components/VideoStage'
import { useCallKeyboard } from './hooks/useCallKeyboard'
import { useMatchSession } from './hooks/useMatchSession'
import { socialStore } from './store/socialStore'
import { useSessionBootstrap } from './hooks/useSessionBootstrap'
import { detectLocale, t as translate } from './i18n'
import { SocialContext } from './context/SocialContext'
import { SocialPage } from './pages/SocialPage'
import {
  applyUserToClient,
  canQuickStart,
  isAgeGateComplete,
} from './utils/clientStorage'

function getFsElement(): Element | null {
  const d = document as Document & { mozFullScreenElement?: Element | null; webkitFullscreenElement?: Element | null; msFullscreenElement?: Element | null }
  return (d.fullscreenElement ?? d.mozFullScreenElement ?? d.webkitFullscreenElement ?? d.msFullscreenElement) ?? null
}

function requestFs(el: Element): Promise<void> | undefined {
  const e = el as Element & { mozRequestFullScreen?: () => Promise<void>; webkitRequestFullscreen?: () => Promise<void>; msRequestFullscreen?: () => Promise<void> }
  return (e.requestFullscreen ?? e.mozRequestFullScreen ?? e.webkitRequestFullscreen ?? e.msRequestFullscreen)?.call(el)
}

function exitFs(): Promise<void> | undefined {
  const d = document as Document & { mozExitFullScreen?: () => Promise<void>; webkitExitFullscreen?: () => Promise<void>; msExitFullscreen?: () => Promise<void> }
  return (d.exitFullscreen ?? d.mozExitFullScreen ?? d.webkitExitFullscreen ?? d.msExitFullscreen)?.call(document)
}

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale)
  const tr = translate(locale)
  const [prefs, setPrefsState] = useState<MatchPreferences>(loadPrefs)
  const setPrefs = (p: MatchPreferences) => {
    setPrefsState(p)
    savePrefs(p)
  }

  const [status, setStatus] = useState(() => translate(detectLocale()).ready)

  const [showStart, setShowStart] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [prefsTab, setPrefsTab] = useState<PrefsTab | undefined>(undefined)
  const [auth, setAuth] = useState(false)
  const [resetTokenFromUrl, setResetTokenFromUrl] = useState('')
  const [settings, setSettings] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [friendManager, setFriendManager] = useState(false)
  const [page, setPage] = useState<PageId>(null)
  const [authActive, setAuthActive] = useState(false)
  const [user, setUser] = useState<PublicUser | null>(getStoredUser)
  const [profileNeeded, setProfileNeeded] = useState(() => {
    const stored = getStoredUser()
    if (stored) {
      const applied = applyUserToClient(stored)
      return !applied.profileComplete
    }
    return !isAgeGateComplete()
  })
  const [fullscreen, setFullscreen] = useState(false)

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

  const handleSocialEvent = useCallback((msg: import('./hooks/useMatchSession').SocialWsEvent) => {
    socialStore.addNotification({
      type: msg.type === 'friend:request' ? 'friend_request'
        : msg.type === 'friend:accepted' ? 'friend_accepted'
        : msg.type === 'message:new' ? 'message'
        : msg.type === 'invitation:send' ? 'invitation'
        : msg.type === 'group:invite' ? 'group_invite'
        : msg.type === 'group:invite:accepted' ? 'group_invite'
        : 'group_invite',
      title: msg.type === 'friend:request' ? 'Friend Request'
        : msg.type === 'friend:accepted' ? 'Request Accepted'
        : msg.type === 'message:new' ? 'New Message'
        : msg.type === 'invitation:send' ? 'Match Invitation'
        : msg.type === 'group:invite' ? 'Group Invite'
        : 'Group Invite',
      body: msg.type === 'invitation:send' ? `${msg.inviter.email.split('@')[0]} invited you to a match`
        : msg.type === 'message:new' ? msg.message.text.slice(0, 80)
        : msg.type === 'group:invite' ? `${msg.inviter.email.split('@')[0]} invited you to "${msg.groupName}"`
        : msg.type === 'group:invite:accepted' ? `Someone joined your group`
        : `${'from' in msg && msg.from ? msg.from.email.split('@')[0] : ''} ${msg.type === 'friend:request' ? 'wants to be your friend' : 'accepted your request'}`,
      from: 'from' in msg && msg.from ? msg.from as SharedPublicUser : undefined,
      data: msg.type === 'message:new' ? { senderId: msg.message.senderId }
        : msg.type === 'invitation:send' ? { invitationId: msg.invitationId, roomId: msg.roomId }
        : msg.type === 'group:invite' ? { inviteId: msg.inviteId, groupId: msg.groupId }
        : undefined,
    })
  }, [])

  const session = useMatchSession({
    tr,
    prefs,
    onStatus: setStatus,
    onGroupMessage: (message) => emitGroupMessage(message),
    onSocialEvent: handleSocialEvent,
  })

  const { appVersion, sharedPrefs } = useSessionBootstrap({
    setUser: applyUser,
    setAuth,
    setResetToken: setResetTokenFromUrl,
    setStatus,
    setOnline: session.setOnline,
    setWaitingCount: session.setWaitingCount,
  })
  const [showSharedPrefs, setShowSharedPrefs] = useState(Boolean(sharedPrefs))

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(Boolean(getFsElement()))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('mozfullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    document.addEventListener('MSFullscreenChange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('mozfullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      document.removeEventListener('MSFullscreenChange', onFullscreenChange)
    }
  }, [])

  const handleFullscreen = () => {
    const el = document.querySelector('.stage-wrap')
    if (!el) return
    if (!getFsElement()) {
      void requestFs(el)
    } else {
      void exitFs()
    }
  }

  const anyModalOpen =
    showStart || preferences || authActive || settings || reportOpen || friendManager || profileNeeded || Boolean(page)

  useCallKeyboard({
    active: session.finding || session.matched,
    muted: session.media.muted,
    cameraOn: session.media.cameraOn,
    setMuted: session.media.setMutedTrack,
    setCamera: session.media.setCameraTrack,
    onNext: session.next,
    onStop: session.stop,
    canNext: session.finding,
    modalOpen: anyModalOpen,
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

  const lookingLabel =
    prefs.lookingFor === GENDER.male
      ? tr.male
      : prefs.lookingFor === GENDER.female
        ? tr.female
        : prefs.lookingFor === GENDER.other
          ? tr.other
          : tr.everyone

  const handleApplySharedPrefs = () => {
    if (!sharedPrefs) return
    const merged = mergePrefs(sharedPrefs, prefs)
    setPrefs(merged)
    setShowSharedPrefs(false)
  }

  return (
    <SocialContext.Provider
      value={{
        user,
        currentUserId: user?.id ?? null,
        match: session.match,
        t: tr,
        onSignIn: () => setAuth(true),
      }}
    >
    <Router>
      <div path="/">
      <main class="app">
      <OfflineBanner label={tr.offline} />

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
          peerEmail={session.peerEmail}
          peerUserId={session.peerUserId}
          relationship={session.relationship}
          callSeconds={session.callSeconds}
          sharedInterests={session.sharedInterests}
          localVideo={session.localVideo}
          remoteVideo={session.remoteVideo}
          hasLocalStream={Boolean(session.media.streamRef.current)}
          user={user}
          onPreferences={() => {
            setPrefsTab(PREFS_TAB.match)
            setPreferences(true)
          }}
          onSettings={() => setSettings(true)}
          onAuthClick={onAuthClick}
          onAddFriend={() => setFriendManager(true)}
          onFollow={() => {
            if (session.peerUserId) {
              void followsApi.follow(session.peerUserId)
            }
          }}
        />
        <CallBar
          t={tr}
          finding={session.finding}
          matched={session.matched}
          muted={session.media.muted}
          cameraOn={session.media.cameraOn}
          quality={session.webrtc.quality}
          canBlock={Boolean(user)}
          devices={session.media.devices}
          videoId={session.media.videoId}
          audioId={session.media.audioId}
          user={user}
          fullscreen={fullscreen}
          sharedPrefs={sharedPrefs}
          showSharedPrefs={showSharedPrefs}
          onStart={onStartClick}
          onMute={() => session.media.setMutedTrack(!session.media.muted)}
          onCamera={() => session.media.setCameraTrack(!session.media.cameraOn)}
          onReport={() => setReportOpen(true)}
          onBlock={() => session.match.block()}
          onRetryIce={() => void session.webrtc.restartIce()}
          onOpenSocial={() => route('/social', true)}
          onApplySharedPrefs={handleApplySharedPrefs}
          onDismissSharedPrefs={() => setShowSharedPrefs(false)}
          onDeviceChange={onDeviceChange}
          onOpenDeviceSettings={() => {
            setPrefsTab(PREFS_TAB.devices)
            setPreferences(true)
          }}
          onRefreshDevices={() => void session.media.refreshDevices()}
          onFullscreen={handleFullscreen}
          onStop={session.stop}
          onNext={session.next}
          onPreferences={() => {
            setPrefsTab(PREFS_TAB.match)
            setPreferences(true)
          }}
          onSettings={() => setSettings(true)}
          onAuthClick={onAuthClick}
          onAddFriend={() => setFriendManager(true)}
          relationship={session.relationship}
        />
      </div>
        {friendManager && (
          <FriendManager
            t={tr}
            user={user}
            onClose={() => setFriendManager(false)}
          />
        )}


      <section class="dashboard">
        <ControlDeck
          t={tr}
          prefs={prefs}
          finding={session.finding}
          matched={session.matched}
          lookingLabel={lookingLabel}
          onStart={onStartClick}
          onStop={session.stop}
          onNext={session.next}
          onOpenPrefs={() => {
            setPrefsTab(PREFS_TAB.match)
            setPreferences(true)
          }}
          onChangeCountry={(country) => {
            setPrefs({ ...prefs, country })
          }}
          onChangeLookingFor={(lookingFor) => {
            setPrefs({ ...prefs, lookingFor })
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
          appVersion={appVersion}
          userEmail={user?.email ?? null}
        />
      </section>

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
        setAuth={(v) => {
          setAuth(v)
          setAuthActive(v)
        }}
        authActive={authActive}
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
    </div>
    <SocialPage path="/social" />
    </Router>
    </SocialContext.Provider>
  )
}

import type { Locale, MatchPreferences, ReportReason } from '../../shared/types'
import { authApi, socialApi, type PublicUser } from '../api'
import type { Messages } from '../i18n'
import type { MediaErrorCode } from '../utils/mediaErrors'
import { AuthModal } from './AuthModal'
import { PreferencesModal, type PrefsTabId } from './PreferencesModal'
import { ProfileModal } from './ProfileModal'
import { RatingPrompt } from './RatingPrompt'
import { ReportModal } from './ReportModal'
import { SettingsModal } from './SettingsModal'
import { StartMatchModal } from './StartMatchModal'
import { StaticPage, type PageId } from './StaticPages'

type MediaSlice = {
  stream: MediaStream | null
  streamVersion: number
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  videoId: string
  audioId: string
  ensureStream: () => Promise<MediaStream>
  errorCode: MediaErrorCode | null
  acquiring: boolean
  refreshDevices: () => Promise<void>
}

export function AppModals({
  t,
  locale,
  prefs,
  setPrefs,
  setLocale,
  user,
  setUser,
  profileNeeded,
  setProfileNeeded,
  showStart,
  setShowStart,
  preferences,
  setPreferences,
  auth,
  setAuth,
  resetTokenFromUrl,
  setResetTokenFromUrl,
  settings,
  setSettings,
  reportOpen,
  setReportOpen,
  rateRoomId,
  setRateRoomId,
  page,
  setPage,
  media,
  prefsInitialTab,
  onBeginMatch,
  onReport,
  onDeviceChange,
}: {
  t: Messages
  locale: Locale
  prefs: MatchPreferences
  setPrefs: (p: MatchPreferences) => void
  setLocale: (l: Locale) => void
  user: PublicUser | null
  setUser: (u: PublicUser | null) => void
  profileNeeded: boolean
  setProfileNeeded: (v: boolean) => void
  showStart: boolean
  setShowStart: (v: boolean) => void
  preferences: boolean
  setPreferences: (v: boolean) => void
  auth: boolean
  setAuth: (v: boolean) => void
  resetTokenFromUrl: string
  setResetTokenFromUrl: (v: string) => void
  settings: boolean
  setSettings: (v: boolean) => void
  reportOpen: boolean
  setReportOpen: (v: boolean) => void
  rateRoomId: string | null
  setRateRoomId: (v: string | null) => void
  page: PageId
  setPage: (p: PageId) => void
  media: MediaSlice
  prefsInitialTab?: PrefsTabId
  onBeginMatch: () => void
  onReport: (reason: ReportReason, detail: string) => void
  onDeviceChange: (kind: 'video' | 'audio', id: string) => void
}) {
  return (
    <>
      {profileNeeded && <ProfileModal t={t} onComplete={() => setProfileNeeded(false)} />}
      {showStart && (
        <StartMatchModal
          t={t}
          prefs={prefs}
          setPrefs={setPrefs}
          stream={media.stream}
          streamVersion={media.streamVersion}
          ensureStream={media.ensureStream}
          devices={media.devices}
          videoId={media.videoId}
          audioId={media.audioId}
          setVideoId={(id) => onDeviceChange('video', id)}
          setAudioId={(id) => onDeviceChange('audio', id)}
          errorCode={media.errorCode}
          acquiring={media.acquiring}
          refreshDevices={media.refreshDevices}
          onConfirm={onBeginMatch}
          onClose={() => setShowStart(false)}
        />
      )}
      {preferences && (
        <PreferencesModal
          t={t}
          prefs={prefs}
          locale={locale}
          setPrefs={setPrefs}
          setLocale={setLocale}
          devices={media.devices}
          videoId={media.videoId}
          audioId={media.audioId}
          onVideoChange={(id) => onDeviceChange('video', id)}
          onAudioChange={(id) => onDeviceChange('audio', id)}
          errorCode={media.errorCode}
          acquiring={media.acquiring}
          ensureStream={media.ensureStream}
          refreshDevices={media.refreshDevices}
          stream={media.stream}
          streamVersion={media.streamVersion}
          initialTab={prefsInitialTab}
          onClose={() => {
            setPreferences(false)
            if (user) void authApi.savePreferences(prefs).catch(() => undefined)
          }}
        />
      )}
      {auth && (
        <AuthModal
          t={t}
          initialResetToken={resetTokenFromUrl || undefined}
          onClose={() => {
            setAuth(false)
            setResetTokenFromUrl('')
          }}
          onAuth={(u) => {
            setUser(u)
          }}
        />
      )}
      {settings && user && (
        <SettingsModal
          t={t}
          user={user}
          onClose={() => setSettings(false)}
          onDeleted={() => setUser(null)}
          onUserUpdate={setUser}
        />
      )}
      {reportOpen && <ReportModal t={t} onClose={() => setReportOpen(false)} onSubmit={onReport} />}
      {rateRoomId && (
        <RatingPrompt
          t={t}
          onSkip={() => setRateRoomId(null)}
          onRate={(score) => {
            void socialApi.rate(score, rateRoomId).catch(() => undefined)
            setRateRoomId(null)
          }}
        />
      )}
      <StaticPage page={page} t={t} onClose={() => setPage(null)} />
    </>
  )
}

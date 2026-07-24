import { useState } from 'preact/hooks'
import type { Locale, MatchPreferences } from '../../shared/types'
import type { Messages } from '../i18n'
import { PREFS_TAB, PrefsTab } from '../../shared/constants'
import type { MediaErrorCode } from '../utils/mediaErrors'
import { Modal } from './Modal'
import { DevicesPrefsTab } from './preferences/DevicesPrefsTab'
import { LocalePrefsTab } from './preferences/LocalePrefsTab'
import { MatchPrefsTab } from './preferences/MatchPrefsTab'

export type PrefsTabId = PrefsTab

export function PreferencesModal({
  t,
  prefs,
  locale,
  setPrefs,
  setLocale,
  devices,
  videoId,
  audioId,
  onVideoChange,
  onAudioChange,
  errorCode,
  acquiring,
  ensureStream,
  refreshDevices,
  stream,
  streamVersion,
  initialTab,
  onClose,
}: {
  t: Messages
  prefs: MatchPreferences
  locale: Locale
  setPrefs: (p: MatchPreferences) => void
  setLocale: (l: Locale) => void
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  videoId: string
  audioId: string
  onVideoChange: (id: string) => void
  onAudioChange: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  ensureStream: () => Promise<MediaStream>
  refreshDevices: () => Promise<void>
  stream: MediaStream | null
  streamVersion: number
  initialTab?: PrefsTabId
  onClose: () => void
}) {
  const [tab, setTab] = useState<PrefsTabId>(() => initialTab ?? (errorCode ? PREFS_TAB.devices : PREFS_TAB.match))

  const tabs: { id: PrefsTabId; label: string }[] = [
    { id: PREFS_TAB.match, label: t.prefsTabMatch },
    { id: PREFS_TAB.devices, label: t.prefsTabDevices },
    { id: PREFS_TAB.language, label: t.prefsTabLanguage },
  ]

  return (
    <Modal onClose={onClose} className="modal prefs-modal" labelledBy="prefs-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <p class="eyebrow">{t.preferences}</p>
      <div class="prefs-tabs" role="tablist" aria-label={t.preferences}>
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            role="tab"
            class={`prefs-tab ${tab === item.id ? 'on' : ''}`}
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === PREFS_TAB.match && <MatchPrefsTab t={t} prefs={prefs} setPrefs={setPrefs} />}
      {tab === PREFS_TAB.devices && (
        <DevicesPrefsTab
          t={t}
          devices={devices}
          videoId={videoId}
          audioId={audioId}
          onVideoChange={onVideoChange}
          onAudioChange={onAudioChange}
          errorCode={errorCode}
          acquiring={acquiring}
          ensureStream={ensureStream}
          refreshDevices={refreshDevices}
          stream={stream}
          streamVersion={streamVersion}
        />
      )}
      {tab === PREFS_TAB.language && <LocalePrefsTab t={t} locale={locale} setLocale={setLocale} />}

      <button class="match full" onClick={onClose}>
        {t.save}
      </button>
    </Modal>
  )
}

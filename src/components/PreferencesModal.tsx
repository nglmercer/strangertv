import { useEffect, useRef, useState } from 'preact/hooks'
import {
  COUNTRY_CODES,
  INTERESTS,
  MATCH_LANGUAGE_CODES,
  type Gender,
  type Locale,
  type MatchPreferences,
} from '../../shared/types'
import { countryLabel, interestLabel, matchLangLabel, type Messages } from '../i18n'
import type { MediaErrorCode } from '../utils/mediaErrors'
import { DevicePickers } from './DevicePickers'
import { Modal } from './Modal'

const genders: Gender[] = ['any', 'male', 'female', 'other']

export function PreferencesModal({
  t,
  prefs,
  locale,
  setPrefs,
  setLocale,
  devices,
  videoId,
  audioId,
  setVideoId,
  setAudioId,
  errorCode,
  acquiring,
  ensureStream,
  refreshDevices,
  stream,
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
  setVideoId: (id: string) => void
  setAudioId: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  ensureStream: () => Promise<MediaStream>
  refreshDevices: () => Promise<void>
  stream: MediaStream | null
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showDevices, setShowDevices] = useState(false)
  const skipReacq = useRef(true)

  const genderLabel = (g: Gender) =>
    g === 'male' ? t.male : g === 'female' ? t.female : g === 'other' ? t.other : t.any

  const toggleInterest = (tag: string) => {
    const has = prefs.interests.includes(tag)
    const interests = has ? prefs.interests.filter((x) => x !== tag) : [...prefs.interests, tag].slice(0, 5)
    setPrefs({ ...prefs, interests })
  }

  const tryStream = () => {
    void ensureStream().catch(() => undefined)
  }

  useEffect(() => {
    if (!showDevices) return
    skipReacq.current = true
    tryStream()
    void refreshDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDevices])

  useEffect(() => {
    if (!showDevices) return
    if (skipReacq.current) {
      skipReacq.current = false
      return
    }
    tryStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, audioId])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream, showDevices])

  return (
    <Modal onClose={onClose} labelledBy="prefs-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <p class="eyebrow">{t.preferences}</p>
      <h2 id="prefs-title">{t.makeYours}</h2>
      <label>
        {t.country}
        <select value={prefs.country} onChange={(e) => setPrefs({ ...prefs, country: e.currentTarget.value })}>
          {COUNTRY_CODES.map((code) => (
            <option value={code} key={code}>
              {countryLabel(t, code)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.matchLanguage}
        <select value={prefs.language} onChange={(e) => setPrefs({ ...prefs, language: e.currentTarget.value })}>
          {MATCH_LANGUAGE_CODES.map((code) => (
            <option value={code} key={code}>
              {matchLangLabel(t, code)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.language}
        <select
          value={locale}
          onChange={(e) => {
            const l = e.currentTarget.value as Locale
            setLocale(l)
            localStorage.setItem('stranger-locale', l)
          }}
        >
          <option value="en">{t.localeEn}</option>
          <option value="es">{t.localeEs}</option>
          <option value="pt">{t.localePt}</option>
        </select>
      </label>
      <label>
        {t.gender}
        <select value={prefs.gender} onChange={(e) => setPrefs({ ...prefs, gender: e.currentTarget.value as Gender })}>
          {genders.map((g) => (
            <option value={g} key={g}>
              {genderLabel(g)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.lookingFor}
        <select
          value={prefs.lookingFor}
          onChange={(e) => setPrefs({ ...prefs, lookingFor: e.currentTarget.value as Gender })}
        >
          {genders.map((g) => (
            <option value={g} key={g}>
              {genderLabel(g)}
            </option>
          ))}
        </select>
      </label>
      <fieldset class="interest-field">
        <legend>{t.interests}</legend>
        <div class="chips">
          {INTERESTS.map((tag) => (
            <button
              type="button"
              key={tag}
              class={`chip ${prefs.interests.includes(tag) ? 'on' : ''}`}
              onClick={() => toggleInterest(tag)}
            >
              {interestLabel(t, tag)}
            </button>
          ))}
        </div>
      </fieldset>

      <div class="prefs-devices">
        <button type="button" class="switch" onClick={() => setShowDevices((v) => !v)}>
          {t.mediaChangeDevices}
        </button>
        {showDevices && (
          <>
            <div class="preview-wrap prefs-preview">
              <video ref={videoRef} autoplay playsinline muted class="preview-video" />
              {!stream && <span class="preview-empty">{t.previewCam}</span>}
            </div>
            <DevicePickers
              t={t}
              devices={devices}
              videoId={videoId}
              audioId={audioId}
              setVideoId={setVideoId}
              setAudioId={setAudioId}
              errorCode={errorCode}
              acquiring={acquiring}
              onRetry={tryStream}
              onRefresh={() => void refreshDevices()}
            />
          </>
        )}
      </div>

      <button class="match full" onClick={onClose}>
        {t.save}
      </button>
    </Modal>
  )
}

import { useEffect, useRef, useState } from 'preact/hooks'
import {
  COUNTRY_CODES,
  INTERESTS,
  MATCH_LANGUAGE_CODES,
  type Gender,
  type MatchPreferences,
} from '../../shared/types'
import { GENDERS } from '../../shared/constants'
import { countryLabel, formatMessage, interestLabel, matchLangLabel, type Messages } from '../i18n'
import {
  acceptTerms,
  getStartWizardStep,
  isTermsAccepted,
  markDevicesReady,
  markMatchSetupComplete,
} from '../utils/clientStorage'
import type { MediaErrorCode } from '../utils/mediaErrors'
import { DevicePickers } from './DevicePickers'
import { Modal } from './Modal'

export function StartMatchModal({
  t,
  prefs,
  setPrefs,
  stream,
  streamVersion,
  ensureStream,
  devices,
  videoId,
  audioId,
  setVideoId,
  setAudioId,
  errorCode,
  acquiring,
  refreshDevices,
  onConfirm,
  onClose,
}: {
  t: Messages
  prefs: MatchPreferences
  setPrefs: (p: MatchPreferences) => void
  stream: MediaStream | null
  streamVersion: number
  ensureStream: () => Promise<MediaStream>
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  videoId: string
  audioId: string
  setVideoId: (id: string) => void
  setAudioId: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  refreshDevices: () => Promise<void>
  onConfirm: () => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [accepted, setAccepted] = useState(() => isTermsAccepted())
  const [step, setStep] = useState(() => getStartWizardStep())
  const [needStreamHint, setNeedStreamHint] = useState(false)

  const tryStream = () => {
    void ensureStream()
      .then(() => setNeedStreamHint(false))
      .catch(() => undefined)
  }

  useEffect(() => {
    if (step < 1) return
    tryStream()
    // Only when entering device step — device picks go through onDeviceChange/switchDevice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (stream) {
      if (el.srcObject !== stream) el.srcObject = stream
      void el.play().catch(() => undefined)
    } else {
      el.srcObject = null
    }
  }, [stream, streamVersion])

  const genderLabel = (g: Gender) =>
    g === 'male' ? t.male : g === 'female' ? t.female : g === 'other' ? t.other : t.any

  const goDevices = () => {
    if (!accepted) return
    acceptTerms()
    setStep(1)
  }

  const goPrefs = () => {
    if (!stream) {
      setNeedStreamHint(true)
      tryStream()
      return
    }
    markDevicesReady()
    setStep(2)
  }

  const finish = () => {
    markMatchSetupComplete()
    onConfirm()
  }

  return (
    <Modal onClose={onClose} className="modal start-modal" labelledBy="start-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <p class="eyebrow">{formatMessage(t.stepOf, { current: step + 1, total: 3 })}</p>
      <h2 id="start-title">{t.startTitle}</h2>

      {step === 0 && (
        <>
          <label class="check-row">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.currentTarget.checked)} />
            <span>{t.acceptTerms}</span>
          </label>
          <p class="modal-copy">{t.mustBe18}</p>
          <button class="match full" disabled={!accepted} onClick={goDevices}>
            {t.nextBtn}
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <div class="preview-wrap">
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
          {needStreamHint && !stream && <p class="form-error">{t.mediaNeedStream}</p>}
          <button class="match full" onClick={goPrefs} disabled={acquiring}>
            {t.nextBtn}
          </button>
        </>
      )}

      {step === 2 && (
        <>
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
            {t.lookingFor}
            <select
              value={prefs.lookingFor}
              onChange={(e) => setPrefs({ ...prefs, lookingFor: e.currentTarget.value as Gender })}
            >
              {GENDERS.map((g) => (
                <option value={g} key={g}>
                  {genderLabel(g)}
                </option>
              ))}
            </select>
          </label>
          <div class="chips">
            {INTERESTS.map((tag) => (
              <button
                type="button"
                key={tag}
                class={`chip ${prefs.interests.includes(tag) ? 'on' : ''}`}
                onClick={() => {
                  const has = prefs.interests.includes(tag)
                  setPrefs({
                    ...prefs,
                    interests: has
                      ? prefs.interests.filter((x) => x !== tag)
                      : [...prefs.interests, tag].slice(0, 5),
                  })
                }}
              >
                {interestLabel(t, tag)}
              </button>
            ))}
          </div>
          <button class="match full" onClick={finish}>
            {t.continueAnon}
          </button>
        </>
      )}
    </Modal>
  )
}

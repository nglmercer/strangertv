import { useEffect, useRef, useState } from 'preact/hooks'
import { COUNTRIES, INTERESTS, MATCH_LANGUAGES, type Gender, type MatchPreferences } from '../../shared/types'
import { formatMessage, type Messages } from '../i18n'
import { Modal } from './Modal'

export function StartMatchModal({
  t,
  prefs,
  setPrefs,
  stream,
  ensureStream,
  devices,
  videoId,
  audioId,
  setVideoId,
  setAudioId,
  onConfirm,
  onClose,
}: {
  t: Messages
  prefs: MatchPreferences
  setPrefs: (p: MatchPreferences) => void
  stream: MediaStream | null
  ensureStream: () => Promise<MediaStream>
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  videoId: string
  audioId: string
  setVideoId: (id: string) => void
  setAudioId: (id: string) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [accepted, setAccepted] = useState(false)
  const [step, setStep] = useState(0)
  const [err, setErr] = useState('')

  useEffect(() => {
    void ensureStream()
      .then(() => setErr(''))
      .catch(() => setErr(t.cameraNeeded))
  }, [])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  const genderLabel = (g: Gender) =>
    g === 'male' ? t.male : g === 'female' ? t.female : g === 'other' ? t.other : t.any

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
          <button class="match full" disabled={!accepted} onClick={() => setStep(1)}>
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
          {err && <p class="form-error">{err}</p>}
          <label>
            {t.deviceCam}
            <select value={videoId} onChange={(e) => setVideoId(e.currentTarget.value)}>
              <option value="">{t.deviceDefault}</option>
              {devices.video.map((d) => (
                <option value={d.deviceId} key={d.deviceId}>
                  {d.label || d.deviceId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.deviceMic}
            <select value={audioId} onChange={(e) => setAudioId(e.currentTarget.value)}>
              <option value="">{t.deviceDefault}</option>
              {devices.audio.map((d) => (
                <option value={d.deviceId} key={d.deviceId}>
                  {d.label || d.deviceId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <button class="match full" onClick={() => setStep(2)}>
            {t.nextBtn}
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <label>
            {t.country}
            <select value={prefs.country} onChange={(e) => setPrefs({ ...prefs, country: e.currentTarget.value })}>
              {COUNTRIES.map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            {t.matchLanguage}
            <select value={prefs.language} onChange={(e) => setPrefs({ ...prefs, language: e.currentTarget.value })}>
              {MATCH_LANGUAGES.map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            {t.lookingFor}
            <select
              value={prefs.lookingFor}
              onChange={(e) => setPrefs({ ...prefs, lookingFor: e.currentTarget.value as Gender })}
            >
              {(['any', 'male', 'female', 'other'] as Gender[]).map((g) => (
                <option value={g}>{genderLabel(g)}</option>
              ))}
            </select>
          </label>
          <div class="chips">
            {INTERESTS.map((tag) => (
              <button
                type="button"
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
                {tag}
              </button>
            ))}
          </div>
          <button
            class="match full"
            onClick={() => {
              localStorage.setItem('stranger-terms-accepted', 'true')
              onConfirm()
            }}
          >
            {t.continueAnon}
          </button>
        </>
      )}
    </Modal>
  )
}

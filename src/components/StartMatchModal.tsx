import { useEffect, useState } from 'preact/hooks'
import {
  COUNTRY_CODES,
  INTERESTS,
  MATCH_LANGUAGE_CODES,
  type Gender,
  type GroupVisibility,
  type MatchMode,
  type MatchPreferences,
  type MatchScope,
} from '../../shared/types'
import { DEFAULT_MATCH_MODE, DEFAULT_MATCH_SCOPE, GENDER, GENDERS } from '../../shared/constants'
import { countryLabel, formatMessage, interestLabel, matchLangLabel, type Messages } from '../i18n'
import {
  getStartWizardStep,
  markDevicesReady,
  markMatchSetupComplete,
} from '../utils/clientStorage'
import type { MediaErrorCode } from '../utils/mediaErrors'
import { MediaSettings } from './MediaSettings'
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
  labelsVisible,
  deviceLost,
  muted,
  cameraOn,
  onToggleMute,
  onToggleCamera,
  onConfirm,
  onClose,
}: {
  t: Messages
  prefs: MatchPreferences
  setPrefs: (p: MatchPreferences) => void
  stream: MediaStream | null
  streamVersion: number
  ensureStream: (force?: boolean) => Promise<MediaStream>
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  videoId: string
  audioId: string
  setVideoId: (id: string) => void
  setAudioId: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  refreshDevices: () => Promise<unknown>
  labelsVisible: boolean
  deviceLost: 'video' | 'audio' | null
  muted: boolean
  cameraOn: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
  onConfirm: (mode: MatchMode, visibility?: GroupVisibility) => void
  onClose: () => void
}) {
  const [step, setStep] = useState(() => Math.max(0, getStartWizardStep() - 1))
  const [mode, setMode] = useState<MatchMode>(prefs.mode ?? DEFAULT_MATCH_MODE)
  const [visibility, setVisibility] = useState<GroupVisibility>('public')
  const [matchScope, setMatchScope] = useState<MatchScope>(prefs.matchScope ?? DEFAULT_MATCH_SCOPE)
  const [needStreamHint, setNeedStreamHint] = useState(false)

  const tryStream = (force = false) => {
    void ensureStream(force)
      .then(() => setNeedStreamHint(false))
      .catch(() => undefined)
  }
  /** Explicit user retry: re-open the devices even if a stream already exists. */
  const retryStream = () => tryStream(true)

  // Acquire as soon as the devices step opens — it is the step that shows the
  // preview, so waiting until the next one left it blank.
  useEffect(() => {
    if (step < 1) return
    tryStream()
  }, [step])

  const genderLabel = (g: Gender) =>
    g === GENDER.male ? t.male : g === GENDER.female ? t.female : g === GENDER.other ? t.other : t.any

  const goDevices = () => setStep(1)

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
    const finalPrefs: MatchPreferences = { ...prefs, mode, matchScope }
    setPrefs(finalPrefs)
    markMatchSetupComplete()
    onConfirm(mode, mode === 'group' ? visibility : undefined)
  }

  const toggleAllowSameUsers = () => {
    setPrefs({ ...prefs, allowMatchWithSameUsers: !prefs.allowMatchWithSameUsers })
  }

  const totalSteps = 3

  return (
    <Modal onClose={onClose} className="modal start-modal" labelledBy="start-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <p class="eyebrow">{formatMessage(t.stepOf, { current: step + 1, total: totalSteps })}</p>
      <h2 id="start-title">{t.startTitle}</h2>

      {step === 0 && (
        <>
          <div class="mode-selector">
            <button
              type="button"
              class={`mode-option ${mode === 'solo' ? 'selected' : ''}`}
              onClick={() => setMode('solo')}
            >
              <span class="mode-icon">◎</span>
              <span class="mode-name">{t.soloMatch ?? 'Solo'}</span>
              <span class="mode-desc">{t.soloMatchDesc ?? 'Random 1-on-1 match with strangers'}</span>
            </button>
            <button
              type="button"
              class={`mode-option ${mode === 'group' ? 'selected' : ''}`}
              onClick={() => setMode('group')}
            >
              <span class="mode-icon">⊞</span>
              <span class="mode-name">{t.groupMatch ?? 'Group'}</span>
              <span class="mode-desc">{t.groupMatchDesc ?? 'Invite friends and match together'}</span>
            </button>
          </div>
          <button class="match full" onClick={goDevices}>
            {t.nextBtn}
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <MediaSettings
            t={t}
            stream={stream}
            streamVersion={streamVersion}
            devices={devices}
            videoId={videoId}
            audioId={audioId}
            setVideoId={setVideoId}
            setAudioId={setAudioId}
            errorCode={errorCode}
            acquiring={acquiring}
            labelsVisible={labelsVisible}
            deviceLost={deviceLost}
            muted={muted}
            cameraOn={cameraOn}
            onToggleMute={onToggleMute}
            onToggleCamera={onToggleCamera}
            onRetry={() => retryStream()}
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
          {mode === 'group' && (
            <div class="group-config">
              <label class="toggle-label">
                <span>{t.groupVisibility ?? 'Group visibility'}</span>
                <div class="radio-group">
                  <label class="radio-label">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'public'}
                      onChange={() => setVisibility('public')}
                    />
                    <span>{t.public ?? 'Public'}</span>
                  </label>
                  <label class="radio-label">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'private'}
                      onChange={() => setVisibility('private')}
                    />
                    <span>{t.private ?? 'Private'}</span>
                  </label>
                </div>
              </label>
              {visibility === 'public' && (
                <label class="toggle-label">
                  <span>{t.matchScope ?? 'Match with'}</span>
                  <select value={matchScope} onChange={(e) => setMatchScope(e.currentTarget.value as MatchScope)}>
                    <option value="all">{t.matchScopeAll ?? 'All (solo + groups)'}</option>
                    <option value="solo">{t.matchScopeSolo ?? 'Solo users only'}</option>
                    <option value="group">{t.matchScopeGroup ?? 'Groups only'}</option>
                  </select>
                </label>
              )}
            </div>
          )}
          <label class="toggle-label">
            <input
              type="checkbox"
              checked={prefs.allowMatchWithSameUsers}
              onChange={toggleAllowSameUsers}
            />
            <span>{t.allowMatchWithSameUsers}</span>
          </label>
          <button class="match full" onClick={finish}>
            {mode === 'group' ? (t.startGroupMatch ?? 'Start Group Match') : t.continueAnon}
          </button>
        </>
      )}
    </Modal>
  )
}

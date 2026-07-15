import {
  COUNTRY_CODES,
  INTERESTS,
  MATCH_LANGUAGE_CODES,
  type Gender,
  type Locale,
  type MatchPreferences,
} from '../../shared/types'
import { countryLabel, interestLabel, matchLangLabel, type Messages } from '../i18n'
import { Modal } from './Modal'

const genders: Gender[] = ['any', 'male', 'female', 'other']

export function PreferencesModal({
  t,
  prefs,
  locale,
  setPrefs,
  setLocale,
  onClose,
}: {
  t: Messages
  prefs: MatchPreferences
  locale: Locale
  setPrefs: (p: MatchPreferences) => void
  setLocale: (l: Locale) => void
  onClose: () => void
}) {
  const genderLabel = (g: Gender) =>
    g === 'male' ? t.male : g === 'female' ? t.female : g === 'other' ? t.other : t.any

  const toggleInterest = (tag: string) => {
    const has = prefs.interests.includes(tag)
    const interests = has ? prefs.interests.filter((x) => x !== tag) : [...prefs.interests, tag].slice(0, 5)
    setPrefs({ ...prefs, interests })
  }

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
      <button class="match full" onClick={onClose}>
        {t.save}
      </button>
    </Modal>
  )
}

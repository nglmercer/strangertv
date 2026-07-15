import {
  COUNTRY_CODES,
  INTERESTS,
  MATCH_LANGUAGE_CODES,
  type Gender,
  type MatchPreferences,
} from '../../../shared/types'
import { countryLabel, interestLabel, matchLangLabel, type Messages } from '../../i18n'

const genders: Gender[] = ['any', 'male', 'female', 'other']

export function MatchPrefsTab({
  t,
  prefs,
  setPrefs,
}: {
  t: Messages
  prefs: MatchPreferences
  setPrefs: (p: MatchPreferences) => void
}) {
  const genderLabel = (g: Gender) =>
    g === 'male' ? t.male : g === 'female' ? t.female : g === 'other' ? t.other : t.any

  const toggleInterest = (tag: string) => {
    const has = prefs.interests.includes(tag)
    const interests = has ? prefs.interests.filter((x) => x !== tag) : [...prefs.interests, tag].slice(0, 5)
    setPrefs({ ...prefs, interests })
  }

  return (
    <div class="prefs-tab-panel" role="tabpanel">
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
    </div>
  )
}

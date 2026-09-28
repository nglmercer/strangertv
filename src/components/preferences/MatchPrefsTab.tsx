import {
  COUNTRY_CODES,
  INTERESTS,
  MATCH_LANGUAGE_CODES,
  type Gender,
  type MatchPool,
  type MatchPreferences,
} from '../../../shared/types'
import { DEFAULT_MATCH_POOL, GENDER, GENDERS, MATCH_POOL } from '../../../shared/constants'
import { countryLabel, interestLabel, matchLangLabel, type Messages } from '../../i18n'
import { Flag } from '../Flag'
import { icons } from '../icons'
import { Select } from '../Select'

/** Distinct glyph per gender option (mars / venus / transgender / globe). */
const genderIcon = (g: string) =>
  g === GENDER.male ? icons.genderMale : g === GENDER.female ? icons.genderFemale : g === GENDER.other ? icons.genderOther : icons.globe

export function MatchPrefsTab({
  t,
  prefs,
  setPrefs,
  isAnonymous,
}: {
  t: Messages
  prefs: MatchPreferences
  setPrefs: (p: MatchPreferences) => void
  isAnonymous: boolean
}) {
  const genderLabel = (g: Gender) =>
    g === GENDER.male ? t.male : g === GENDER.female ? t.female : g === GENDER.other ? t.other : t.any

  const genderOptions = GENDERS.map((g) => ({ value: g, label: genderLabel(g), icon: genderIcon(g) }))

  const toggleInterest = (tag: string) => {
    const has = prefs.interests.includes(tag)
    const interests = has ? prefs.interests.filter((x) => x !== tag) : [...prefs.interests, tag].slice(0, 5)
    setPrefs({ ...prefs, interests })
  }

  const toggleAllowSameUsers = () => {
    setPrefs({ ...prefs, allowMatchWithSameUsers: !prefs.allowMatchWithSameUsers })
  }

  return (
    <div class="prefs-tab-panel" role="tabpanel">
      {isAnonymous && <p class="form-info">{t.anonFiltersLocked}</p>}
      {!isAnonymous && (
        <label>
          {t.matchPool}
          <Select
            t={t}
            label={t.matchPool}
            value={prefs.matchPool ?? DEFAULT_MATCH_POOL}
            options={[
              { value: MATCH_POOL.all, label: t.matchPoolAll, icon: icons.globe },
              { value: MATCH_POOL.registered, label: t.matchPoolRegistered, icon: icons.userPlus },
            ]}
            onChange={(matchPool: string) => setPrefs({ ...prefs, matchPool: matchPool as MatchPool })}
          />
        </label>
      )}
      <label>
        {t.country}
        <Select
          t={t}
          label={t.country}
          value={prefs.country}
          options={COUNTRY_CODES.map((code) => ({
            value: code,
            label: countryLabel(t, code),
            art: <Flag code={code} size={20} />,
          }))}
          onChange={(country: string) => setPrefs({ ...prefs, country })}
          searchable
          disabled={isAnonymous}
        />
      </label>
      <label>
        {t.matchLanguage}
        <Select
          t={t}
          label={t.matchLanguage}
          value={prefs.language}
          options={MATCH_LANGUAGE_CODES.map((code) => ({ value: code, label: matchLangLabel(t, code), icon: icons.globe }))}
          onChange={(language: string) => setPrefs({ ...prefs, language })}
          disabled={isAnonymous}
        />
      </label>
      <label>
        {t.gender}
        <Select
          t={t}
          label={t.gender}
          value={prefs.gender}
          options={genderOptions}
          onChange={(gender: string) => setPrefs({ ...prefs, gender: gender as Gender })}
          disabled={isAnonymous}
        />
      </label>
      <label>
        {t.lookingFor}
        <Select
          t={t}
          label={t.lookingFor}
          value={prefs.lookingFor}
          options={genderOptions}
          onChange={(lookingFor: string) => setPrefs({ ...prefs, lookingFor: lookingFor as Gender })}
          disabled={isAnonymous}
        />
      </label>
      <fieldset class="interest-field" disabled={isAnonymous}>
        <legend>{t.interests}</legend>
        <div class="chips">
          {INTERESTS.map((tag) => (
            <button
              type="button"
              key={tag}
              class={`chip ${prefs.interests.includes(tag) ? 'on' : ''}`}
              onClick={() => toggleInterest(tag)}
              disabled={isAnonymous}
            >
              {interestLabel(t, tag)}
            </button>
          ))}
        </div>
      </fieldset>
      <label class="toggle-label">
        <input
          type="checkbox"
          checked={prefs.allowMatchWithSameUsers}
          onChange={toggleAllowSameUsers}
        />
        <span>{t.allowMatchWithSameUsers}</span>
      </label>
    </div>
  )
}

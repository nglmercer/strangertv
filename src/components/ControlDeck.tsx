import { useState } from 'preact/hooks'
import { COUNTRY_CODES, type Gender, type MatchPreferences } from '../../shared/types'
import { countryLabel, type Messages } from '../i18n'
import { GENDER, GENDERS } from '../../shared/constants'
import { sharePrefsUrl } from '../utils/sharePrefs'
import { DeckSelect } from './DeckSelect'
import { Flag } from './Flag'
import { Icon, icons } from './icons'

/** Distinct glyph per "looking for" option (mars / venus / transgender / globe). */
const genderIcon = (g: string) =>
  g === GENDER.male ? icons.genderMale : g === GENDER.female ? icons.genderFemale : g === GENDER.other ? icons.genderOther : icons.globe

export function ControlDeck({
  t,
  prefs,
  finding,
  matched,
  isGroupMatch,
  lookingLabel,
  onStart,
  onStop,
  onNext,
  onChangeCountry,
  onChangeLookingFor,
}: {
  t: Messages
  prefs: MatchPreferences
  finding: boolean
  matched: boolean
  isGroupMatch: boolean
  lookingLabel: string
  onStart: () => void
  onStop: () => void
  onNext: () => void
  onOpenPrefs?: () => void
  onChangeCountry: (country: string) => void
  onChangeLookingFor: (gender: Gender) => void
}) {
  const isActive = finding || matched
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    const url = sharePrefsUrl(prefs)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div class="deck">
      {!isActive ? (
        <button
          type="button"
          class="deck-card start"
          onClick={onStart}
          title={t.findStranger}
        >
          <span>{t.start}</span>
        </button>
      ) : (
        <button
          type="button"
          class="deck-card next"
          onClick={onNext}
          title={t.skipNext}
        >
          <span>{t.next}</span>
        </button>
      )}
      <button
        type="button"
        class="deck-card stop"
        onClick={onStop}
        disabled={!isActive}
        title={t.endConversation}
      >
        <span>{t.stop}</span>
      </button>
      <DeckSelect
        t={t}
        label={t.country}
        value={prefs.country}
        options={COUNTRY_CODES.map((code) => ({ value: code, label: countryLabel(t, code), art: <Flag code={code} size={20} /> }))}
        onChange={onChangeCountry}
        searchable
        triggerIcon={<Flag code={prefs.country} size={26} />}
        triggerLabel={countryLabel(t, prefs.country)}
        triggerTitle={`${t.country}: ${countryLabel(t, prefs.country)}`}
      />
      <DeckSelect
        t={t}
        label={t.lookingFor}
        value={prefs.lookingFor}
        options={GENDERS.map((g) => ({
          value: g,
          label: g === GENDER.male ? t.male : g === GENDER.female ? t.female : g === GENDER.other ? t.other : t.everyone,
          icon: genderIcon(g),
        }))}
        onChange={(next) => onChangeLookingFor(next as Gender)}
        triggerIcon={<Icon d={genderIcon(prefs.lookingFor)} size={24} />}
        triggerLabel={lookingLabel}
        triggerTitle={`${t.lookingFor}: ${lookingLabel}`}
      />
      <button
        type="button"
        class={`deck-card deck-share ${copied ? 'copied' : ''}`}
        onClick={handleShare}
        title={t.sharePrefs}
        aria-label={t.sharePrefs}
      >
        <span class="deck-emoji" aria-hidden="true">
          <Icon d={icons.share} size={18} />
        </span>
        <small>{copied ? t.sharePrefsCopied : t.sharePrefs}</small>
      </button>
    </div>
  )
}

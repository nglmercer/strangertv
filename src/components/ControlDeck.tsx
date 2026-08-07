import { useState } from 'preact/hooks'
import { COUNTRY_CODES, type Gender, type MatchPreferences } from '../../shared/types'
import { countryLabel, type Messages } from '../i18n'
import { DEFAULT_COUNTRY, GENDERS } from '../../shared/constants'
import { sharePrefsUrl } from '../utils/sharePrefs'
import { DeckSelect } from './DeckSelect'
import { Icon, icons } from './icons'

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
  const countryDisplay = prefs.country === DEFAULT_COUNTRY ? <Icon d={icons.globe} size={18} /> : prefs.country
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
        options={COUNTRY_CODES.map((code) => ({ value: code, label: countryLabel(t, code), icon: code === DEFAULT_COUNTRY ? icons.globe : undefined }))}
        onChange={onChangeCountry}
        searchable
        triggerIcon={countryDisplay}
        triggerLabel={countryLabel(t, prefs.country)}
        triggerTitle={`${t.country}: ${countryLabel(t, prefs.country)}`}
      />
      <DeckSelect
        t={t}
        label={t.lookingFor}
        value={prefs.lookingFor}
        options={GENDERS.map((g) => ({
          value: g,
          label: g === GENDERS[1] ? t.male : g === GENDERS[2] ? t.female : g === GENDERS[3] ? t.other : t.everyone,
          icon: g === GENDERS[0] ? icons.globe : icons.user,
        }))}
        onChange={(next) => onChangeLookingFor(next as Gender)}
        triggerIcon={prefs.lookingFor === GENDERS[0] ? <Icon d={icons.globe} size={18} /> : <Icon d={icons.user} size={18} />}
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

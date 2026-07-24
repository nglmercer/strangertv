import { useEffect, useRef, useState } from 'preact/hooks'
import { COUNTRY_CODES, type Gender, type MatchPreferences } from '../../shared/types'
import { countryLabel, type Messages } from '../i18n'
import { DEFAULT_COUNTRY, GENDERS } from '../../shared/constants'

type DropdownKind = 'country' | 'gender' | null

export function ControlDeck({
  t,
  prefs,
  finding,
  matched,
  autoNext,
  genderEmoji,
  lookingLabel,
  onStart,
  onStop,
  onNext,
  onOpenPrefs,
  onToggleAutoNext,
  onChangeCountry,
  onChangeLookingFor,
}: {
  t: Messages
  prefs: MatchPreferences
  finding: boolean
  matched: boolean
  autoNext: boolean
  genderEmoji: string
  lookingLabel: string
  onStart: () => void
  onStop: () => void
  onNext: () => void
  onOpenPrefs: () => void
  onToggleAutoNext: () => void
  onChangeCountry: (country: string) => void
  onChangeLookingFor: (gender: Gender) => void
}) {
  const [dropdown, setDropdown] = useState<DropdownKind>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const isActive = finding || matched
  const countryDisplay = prefs.country === DEFAULT_COUNTRY ? '🌐' : prefs.country

  useEffect(() => {
    if (!dropdown) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setDropdown(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdown(null)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [dropdown])

  const toggleDropdown = (kind: Exclude<DropdownKind, null>) => {
    setDropdown((cur) => (cur === kind ? null : kind))
  }

  return (
    <div class="deck" ref={rootRef}>
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
          disabled={!finding}
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
      <div class={`deck-card deck-dropdown ${dropdown === 'country' ? 'open' : ''}`}>
        <button
          type="button"
          class="deck-dropdown-trigger"
          onClick={() => toggleDropdown('country')}
          aria-expanded={dropdown === 'country'}
          aria-haspopup="menu"
          title={`${t.country}: ${countryLabel(t, prefs.country)}`}
        >
          <span class="deck-emoji" aria-hidden="true">
            {countryDisplay}
          </span>
          <small>{countryLabel(t, prefs.country)}</small>
        </button>
        {dropdown === 'country' && (
          <div class="deck-dropdown-menu" role="menu" aria-label={t.country}>
            {COUNTRY_CODES.map((code) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={prefs.country === code}
                class={`deck-dropdown-item ${prefs.country === code ? 'is-selected' : ''}`}
                key={code}
                onClick={() => {
                  onChangeCountry(code)
                  setDropdown(null)
                }}
              >
                <span class="deck-dropdown-check">
                  {prefs.country === code ? '✓' : ''}
                </span>
                <span class="deck-dropdown-label">{countryLabel(t, code)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div class={`deck-card deck-dropdown ${dropdown === 'gender' ? 'open' : ''}`}>
        <button
          type="button"
          class="deck-dropdown-trigger"
          onClick={() => toggleDropdown('gender')}
          aria-expanded={dropdown === 'gender'}
          aria-haspopup="menu"
          title={`${t.lookingFor}: ${lookingLabel}`}
        >
          <span class="deck-emoji" aria-hidden="true">
            {genderEmoji}
          </span>
          <small>{lookingLabel}</small>
        </button>
        {dropdown === 'gender' && (
          <div class="deck-dropdown-menu" role="menu" aria-label={t.lookingFor}>
            {GENDERS.map((g) => {
              const label =
                g === GENDERS[1]
                  ? t.male
                  : g === GENDERS[2]
                    ? t.female
                    : g === GENDERS[3]
                      ? t.other
                      : t.everyone
              const emoji =
                g === GENDERS[1] ? '👨' : g === GENDERS[2] ? '👩' : g === GENDERS[3] ? '🧑' : '🌐'
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={prefs.lookingFor === g}
                  class={`deck-dropdown-item ${prefs.lookingFor === g ? 'is-selected' : ''}`}
                  key={g}
                  onClick={() => {
                    onChangeLookingFor(g as Gender)
                    setDropdown(null)
                  }}
                >
                  <span class="deck-dropdown-emoji">{emoji}</span>
                  <span class="deck-dropdown-check">
                    {prefs.lookingFor === g ? '✓' : ''}
                  </span>
                  <span class="deck-dropdown-label">{label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        class={`deck-card ${autoNext ? 'auto-on' : ''}`}
        onClick={onToggleAutoNext}
        aria-pressed={autoNext}
        title={t.autoNext}
      >
        <span>{t.autoNext}</span>
        <small>{autoNext ? t.autoNextOn : t.autoNextOff}</small>
      </button>
    </div>
  )
}

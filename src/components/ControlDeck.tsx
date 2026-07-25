import { useEffect, useRef, useState } from 'preact/hooks'
import { COUNTRY_CODES, type Gender, type MatchPreferences } from '../../shared/types'
import { countryLabel, type Messages } from '../i18n'
import { DEFAULT_COUNTRY, GENDERS } from '../../shared/constants'
import { sharePrefsUrl } from '../utils/sharePrefs'
import { Icon, icons } from './icons'

type DropdownKind = 'country' | 'gender' | null

export function ControlDeck({
  t,
  prefs,
  finding,
  matched,
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
  lookingLabel: string
  onStart: () => void
  onStop: () => void
  onNext: () => void
  onOpenPrefs?: () => void
  onChangeCountry: (country: string) => void
  onChangeLookingFor: (gender: Gender) => void
}) {
  const [dropdown, setDropdown] = useState<DropdownKind>(null)
  const rootRef = useRef<HTMLDivElement>(null)

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
                  {prefs.country === code ? <Icon d={icons.check} size={16} /> : null}
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
            {prefs.gender === GENDERS[0] ? <Icon d={icons.globe} size={18} /> : <Icon d={icons.user} size={18} />}
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
              const genderIcon = g === GENDERS[0] ? icons.globe : icons.user
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
                  <span class="deck-dropdown-emoji"><Icon d={genderIcon} size={18} /></span>
                  <span class="deck-dropdown-check">
                    {prefs.lookingFor === g ? <Icon d={icons.check} size={16} /> : null}
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

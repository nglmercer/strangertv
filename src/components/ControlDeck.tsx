import type { MatchPreferences } from '../../shared/types'
import { countryLabel, type Messages } from '../i18n'

export function ControlDeck({
  t,
  prefs,
  finding,
  autoNext,
  genderEmoji,
  lookingLabel,
  onStart,
  onStop,
  onOpenPrefs,
  onToggleAutoNext,
}: {
  t: Messages
  prefs: MatchPreferences
  finding: boolean
  autoNext: boolean
  genderEmoji: string
  lookingLabel: string
  onStart: () => void
  onStop: () => void
  onOpenPrefs: () => void
  onToggleAutoNext: () => void
}) {
  const countryDisplay = prefs.country === 'any' ? '🌐' : prefs.country

  return (
    <div class="deck">
      <button
        type="button"
        class="deck-card start"
        onClick={onStart}
        disabled={finding}
        title={t.findStranger}
      >
        <span>{t.start}</span>
      </button>
      <button
        type="button"
        class="deck-card stop"
        onClick={onStop}
        disabled={!finding}
        title={t.endConversation}
      >
        <span>{t.stop}</span>
      </button>
      <button
        type="button"
        class="deck-card"
        onClick={onOpenPrefs}
        title={`${t.country}: ${countryLabel(t, prefs.country)}`}
      >
        <span class="deck-emoji" aria-hidden="true">
          {countryDisplay}
        </span>
        <small>{countryLabel(t, prefs.country)}</small>
      </button>
      <button
        type="button"
        class="deck-card"
        onClick={onOpenPrefs}
        title={`${t.lookingFor}: ${lookingLabel}`}
      >
        <span class="deck-emoji" aria-hidden="true">
          {genderEmoji}
        </span>
        <small>{lookingLabel}</small>
      </button>
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

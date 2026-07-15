import type { MatchPreferences } from '../../shared/types'
import type { Messages } from '../i18n'

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
  return (
    <div class="deck">
      <button type="button" class="deck-card start" onClick={onStart} disabled={finding}>
        <span>{t.start}</span>
        <small>{t.findStranger}</small>
      </button>
      <button type="button" class="deck-card stop" onClick={onStop} disabled={!finding}>
        <span>{t.stop}</span>
        <small>{t.endConversation}</small>
      </button>
      <button type="button" class="deck-card" onClick={onOpenPrefs}>
        <span>
          {t.country} <b>{prefs.country === 'any' ? '🌐' : prefs.country}</b>
        </span>
        <small>{prefs.country}</small>
      </button>
      <button type="button" class="deck-card" onClick={onOpenPrefs}>
        <span>
          {t.gender} <b>{genderEmoji}</b>
        </span>
        <small>{lookingLabel}</small>
      </button>
      <button
        type="button"
        class={`deck-card ${autoNext ? 'auto-on' : ''}`}
        onClick={onToggleAutoNext}
        aria-pressed={autoNext}
      >
        <span>{t.autoNext}</span>
        <small>{autoNext ? t.autoNextOn : t.autoNextOff}</small>
      </button>
    </div>
  )
}

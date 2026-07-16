import type { Messages } from '../i18n'
import type { PublicUser } from '../api'

export function TopBar({
  t,
  online,
  waitingCount,
  signalOk,
  user,
  pinned,
  onTogglePin,
  onPreferences,
  onSettings,
  onAuthClick,
}: {
  t: Messages
  online: number
  waitingCount: number
  signalOk: boolean
  user: PublicUser | null
  pinned: boolean
  onTogglePin: () => void
  onPreferences: () => void
  onSettings: () => void
  onAuthClick: () => void
}) {
  const signalTitle = signalOk ? t.wsConnected : t.wsDisconnected

  return (
    <header class={`topbar${pinned ? ' pinned' : ''}`}>
      <button
        type="button"
        class="topbar-peek"
        onClick={onTogglePin}
        aria-label={pinned ? t.collapseHeader : t.expandHeader}
        title={pinned ? t.collapseHeader : t.expandHeader}
      >
        {pinned ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        )}
      </button>
      <a class="brand" href="/" title={t.live}>
        ✦ {t.brand}
      </a>
      <div class="online" aria-live="polite">
        <i
          class={signalOk ? 'on' : 'off'}
          title={signalTitle}
          aria-label={signalTitle}
        />
        <span class="stats">
          {online} {t.online}
          <span class="stats-sep" aria-hidden="true">
            ·
          </span>
          {waitingCount} {t.waiting}
        </span>
      </div>
      <div class="header-actions">
        <button type="button" class="sign ghost" onClick={onPreferences}>
          {t.preferences}
        </button>
        {user && (
          <button type="button" class="sign ghost" onClick={onSettings}>
            {t.settings}
          </button>
        )}
        <button type="button" class="sign" onClick={onAuthClick}>
          {user ? t.signOut : t.signIn}
        </button>
      </div>
    </header>
  )
}

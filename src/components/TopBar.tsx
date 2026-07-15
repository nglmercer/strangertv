import type { Messages } from '../i18n'
import type { PublicUser } from '../api'

export function TopBar({
  t,
  online,
  waitingCount,
  signalOk,
  user,
  onPreferences,
  onSettings,
  onAuthClick,
}: {
  t: Messages
  online: number
  waitingCount: number
  signalOk: boolean
  user: PublicUser | null
  onPreferences: () => void
  onSettings: () => void
  onAuthClick: () => void
}) {
  return (
    <header class="topbar">
      <a class="brand" href="/">
        ✦ {t.brand}
      </a>
      <div class="online" aria-live="polite">
        <i class={signalOk ? 'on' : 'off'} /> {t.live}
        <span class="stats">
          · {online} {t.online} · {waitingCount} {t.waiting}
          {' · '}
          <span class={signalOk ? 'ws-ok' : 'ws-bad'}>{signalOk ? t.wsConnected : t.wsDisconnected}</span>
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

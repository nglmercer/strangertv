import { SERVER_ERROR_CODE } from '../../shared/constants'
import type { MatchBlocked } from '../hooks/useMatchSession'
import type { Messages } from '../i18n'

/**
 * Explains why matchmaking is unavailable: banned, signed out while guests
 * are disabled, underage, or unverified email. Previously these arrived as a
 * bare status line with no component and no logs.
 */
export function MatchBlockedBanner({
  t,
  blocked,
  showSignIn,
  onSignIn,
}: {
  t: Messages
  blocked: MatchBlocked | null
  showSignIn: boolean
  onSignIn: () => void
}) {
  if (!blocked) return null
  const title =
    blocked.code === SERVER_ERROR_CODE.banned
      ? t.matchBlockedBanned
      : blocked.code === SERVER_ERROR_CODE.ageRestricted
        ? t.matchBlockedAge
        : blocked.code === SERVER_ERROR_CODE.emailUnverified
          ? t.matchBlockedEmail
          : t.matchBlockedAuth
  const danger = blocked.code === SERVER_ERROR_CODE.banned
  return (
    <div class={`match-blocked ${danger ? 'is-danger' : 'is-warn'}`} role="alert">
      <span class="match-blocked-text">
        <strong>{title}</strong>
        <span>{blocked.message}</span>
      </span>
      {showSignIn && blocked.code === SERVER_ERROR_CODE.authRequired && (
        <button type="button" class="match-blocked-cta" onClick={onSignIn}>
          {t.signIn}
        </button>
      )}
    </div>
  )
}

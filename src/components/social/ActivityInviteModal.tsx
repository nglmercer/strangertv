import type { PublicUser } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

/**
 * In-call game party prompt: another call participant invites you to their
 * game. Anonymous receivers cannot hold a seat, so Join stays disabled
 * behind a sign-in hint instead of failing on the server round-trip.
 */
export function ActivityInviteModal({
  t,
  inviter,
  activityName,
  canJoin,
  onJoin,
  onDecline,
}: {
  t: Messages
  inviter: PublicUser
  activityName: string
  canJoin: boolean
  onJoin: () => void
  onDecline: () => void
}) {
  const inviterName = inviter.email ? inviter.email.split('@')[0] : `User ${inviter.id}`
  return (
    <div class="modal-backdrop">
      <div class="modal group-match-invite-modal">
        <div class="group-invite-icon">
          <Icon d={icons.game} size={32} />
        </div>
        <h2>{t.activityInviteTitle}</h2>
        <p class="group-invite-text">
          <strong>{inviterName}</strong> {t.activityInviteBody} <strong>{activityName}</strong>
        </p>
        {!canJoin && <p class="group-invite-text">{t.activityInviteLoginRequired}</p>}
        <div class="group-invite-actions">
          <button type="button" class="btn primary" disabled={!canJoin} onClick={onJoin}>
            {t.joinGame}
          </button>
          <button type="button" class="btn ghost" onClick={onDecline}>
            {t.groupMatchInviteDeny}
          </button>
        </div>
      </div>
    </div>
  )
}

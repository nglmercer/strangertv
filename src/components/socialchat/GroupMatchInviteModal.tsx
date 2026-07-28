import type { PublicUser } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

export function GroupMatchInviteModal({
  t,
  host,
  onAccept,
  onDecline,
}: {
  t: Messages
  host: PublicUser
  onAccept: () => void
  onDecline: () => void
}) {
  const hostName = host.email ? host.email.split('@')[0] : `User ${host.id}`
  return (
    <div class="modal-backdrop">
      <div class="modal group-match-invite-modal">
        <div class="group-invite-icon">
          <Icon d={icons.users} size={32} />
        </div>
        <h2>{t.groupMatchInviteTitle}</h2>
        <p class="group-invite-text">
          <strong>{hostName}</strong> {t.groupMatchInviteBody}
        </p>
        <div class="group-invite-actions">
          <button type="button" class="btn primary" onClick={onAccept}>
            {t.groupMatchInviteAccept}
          </button>
          <button type="button" class="btn ghost" onClick={onDecline}>
            {t.groupMatchInviteDeny}
          </button>
        </div>
      </div>
    </div>
  )
}

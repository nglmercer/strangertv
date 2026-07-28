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
    <div class="modal-overlay">
      <div class="modal group-match-invite-modal">
        <div class="modal-header">
          <h3>{t.groupMatchInviteTitle}</h3>
        </div>
        <div class="modal-body">
          <div class="group-match-invite-info">
            <span class="group-match-invite-icon">
              <Icon d={icons.users} size={28} />
            </span>
            <p>
              <strong>{hostName}</strong> {t.groupMatchInviteBody}
            </p>
          </div>
          <div class="group-match-invite-actions">
            <button type="button" class="btn primary" onClick={onAccept}>
              {t.groupMatchInviteAccept}
            </button>
            <button type="button" class="btn ghost" onClick={onDecline}>
              {t.groupMatchInviteDeny}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

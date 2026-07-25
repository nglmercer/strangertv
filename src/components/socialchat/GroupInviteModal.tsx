import type { Group } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

export function GroupInviteModal({
  t,
  groups,
  friendName,
  onSelect,
  onClose,
}: {
  t: Messages
  groups: Group[]
  friendName: string
  onSelect: (groupId: number) => void
  onClose: () => void
}) {
  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal group-invite-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>{t.selectGroupToInvite}</h3>
          <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
            <Icon d={icons.close} />
          </button>
        </div>
        <div class="modal-body">
          {groups.length === 0 ? (
            <p class="group-invite-empty">{t.noGroupsToInvite}</p>
          ) : (
            <ul class="group-invite-list">
              {groups.map((g) => (
                <li key={g.id}>
                  <button type="button" class="group-invite-item" onClick={() => onSelect(g.id)}>
                    <span class="group-invite-icon">
                      <Icon d={icons.users} size={18} />
                    </span>
                    <span class="group-invite-info">
                      <span class="group-invite-name">{g.name}</span>
                      <span class="group-invite-meta">
                        {g.memberCount} {t.members}
                      </span>
                    </span>
                    <Icon d={icons.arrowRight} size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

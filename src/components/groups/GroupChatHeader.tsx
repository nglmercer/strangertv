import type { Messages } from '../../i18n'
import type { Group, GroupMember } from '../../../shared/types'

export function GroupChatHeader({
  t,
  group,
  members,
  onBack,
  onOpenMembers,
}: {
  t: Messages
  group: Group | null
  members: GroupMember[]
  onBack: () => void
  onOpenMembers: () => void
}) {
  return (
    <div class="group-chat-header">
      <button type="button" class="group-back-btn" onClick={onBack} aria-label={t.close}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>
      <div class="group-chat-header-info">
        <h3>{group?.name ?? ''}</h3>
        <span class="group-chat-header-members">
          {members.length} {t.members}
        </span>
      </div>
      <button type="button" class="group-header-action" onClick={onOpenMembers} aria-label={t.addMembers}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M20 8v6M23 11h-6" />
        </svg>
      </button>
    </div>
  )
}
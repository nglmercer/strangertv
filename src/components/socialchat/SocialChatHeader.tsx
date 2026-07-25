import type { Group, GroupMember, Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'

type ActiveChat =
  | { type: 'group'; id: number }
  | { type: 'friend'; id: number }

export function SocialChatHeader({
  t,
  activeChat,
  group,
  friend,
  members,
  onBack,
  onOpenMembers,
}: {
  t: Messages
  activeChat: ActiveChat
  group: Group | null
  friend: Friend | null
  members: GroupMember[]
  onBack: () => void
  onOpenMembers: () => void
}) {
  const isGroup = activeChat.type === 'group'
  const title = isGroup ? group?.name ?? '' : friend?.otherUser.email.split('@')[0] ?? ''
  const subtitle = isGroup
    ? `${members.length} ${t.members}`
    : friend?.otherUser.email ?? ''

  return (
    <div class="social-chat-header">
      <button type="button" class="social-back-btn" onClick={onBack} aria-label={t.close}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>

      <div class="social-chat-header-avatar">
        {isGroup ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        )}
      </div>

      <div class="social-chat-header-info">
        <h3>{title}</h3>
        <span class="social-chat-header-sub">{subtitle}</span>
      </div>

      {isGroup && (
        <button type="button" class="social-header-action" onClick={onOpenMembers} aria-label={t.addMembers}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <path d="M20 8v6M23 11h-6" />
          </svg>
        </button>
      )}
    </div>
  )
}

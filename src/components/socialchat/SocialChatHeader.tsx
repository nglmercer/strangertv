import type { Group, GroupMember, Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

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
        <Icon d={icons.arrowLeft} />
      </button>

      <div class="social-chat-header-avatar">
        {isGroup ? (
          <Icon d={icons.users} size={20} />
        ) : (
          <Icon d={icons.user} size={20} />
        )}
      </div>

      <div class="social-chat-header-info">
        <h3>{title}</h3>
        <span class="social-chat-header-sub">{subtitle}</span>
      </div>

      {isGroup && (
        <button type="button" class="social-header-action" onClick={onOpenMembers} aria-label={t.addMembers}>
          <Icon d={icons.userPlus} />
        </button>
      )}
    </div>
  )
}

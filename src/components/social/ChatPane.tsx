import type { Friend, Group } from '../../../shared/types'
import { formatMessage, type Messages } from '../../i18n'
import { useSocialStore } from '../../store/socialStore'
import { Icon, icons } from '../icons'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { displayName } from './ConversationList'
import { MessageThread } from './MessageThread'
import type { AnyMessage, ChatId, LoadState } from '../../hooks/useSocialData'

/** Header + thread + composer for the open conversation. */
export function ChatPane({
  t,
  chat,
  group,
  friend,
  memberCount,
  messages,
  messagesState,
  currentUserId,
  infoOpen,
  onBack,
  onToggleInfo,
  onInviteToGroup,
  onSend,
  onRetry,
}: {
  t: Messages
  chat: ChatId
  group: Group | null
  friend: Friend | null
  memberCount: number
  messages: AnyMessage[]
  messagesState: LoadState
  currentUserId: number
  infoOpen: boolean
  onBack: () => void
  onToggleInfo: () => void
  onInviteToGroup?: () => void
  onSend: (text: string) => Promise<void>
  onRetry: () => void
}) {
  const store = useSocialStore()
  const isGroup = chat.kind === 'group'
  const name = isGroup ? group?.name ?? '' : displayName(friend?.otherUser.email ?? '')
  const online = !isGroup && friend ? store.isOnline(friend.otherUser.id) : false
  const subtitle = isGroup
    ? memberCount === 1
      ? t.memberCountOne
      : formatMessage(t.memberCount, { count: memberCount })
    : online
      ? t.online
      : t.presenceOffline

  return (
    <section class="chat-pane">
      <header class="chat-top">
        <button type="button" class="icon-btn chat-back" onClick={onBack} aria-label={t.backToList}>
          <Icon d={icons.arrowLeft} size={18} />
        </button>
        <Avatar
          name={name}
          kind={isGroup ? 'group' : 'user'}
          size={38}
          presence={isGroup ? undefined : online ? 'online' : 'offline'}
        />
        <span class="chat-top-text">
          <span class="chat-top-name">{name}</span>
          <span class="chat-top-sub">{subtitle}</span>
        </span>
        {!isGroup && onInviteToGroup && (
          <button type="button" class="icon-btn" onClick={onInviteToGroup} title={t.inviteToGroup} aria-label={t.inviteToGroup}>
            <Icon d={icons.users} size={18} />
          </button>
        )}
        {isGroup && (
          <button
            type="button"
            class={`icon-btn ${infoOpen ? 'on' : ''}`}
            onClick={onToggleInfo}
            title={t.groupInfo}
            aria-label={t.groupInfo}
            aria-expanded={infoOpen}
          >
            <Icon d={icons.settings} size={18} />
          </button>
        )}
      </header>

      <MessageThread
        t={t}
        messages={messages}
        state={messagesState}
        currentUserId={currentUserId}
        showSenders={isGroup}
        onRetry={onRetry}
      />

      <Composer t={t} onSend={onSend} />
    </section>
  )
}

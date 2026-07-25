import { useRef } from 'preact/hooks'
import type { RefObject } from 'preact'
import type { Group, GroupMember, GroupMessage, Friend, Message } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { SocialChatHeader } from './SocialChatHeader'
import { MessagesList } from './MessagesList'
import { MessageInput } from './MessageInput'

type ActiveChat =
  | { type: 'group'; id: number }
  | { type: 'friend'; id: number }

export function SocialChat({
  t,
  activeChat,
  group,
  friend,
  members,
  messages,
  messageText,
  setMessageText,
  currentUserId,
  onBack,
  onOpenMembers,
  onSend,
  onToggleMenu,
  onInviteToGroup,
}: {
  t: Messages
  activeChat: ActiveChat
  group: Group | null
  friend: Friend | null
  members: GroupMember[]
  messages: (GroupMessage | Message)[]
  messageText: string
  setMessageText: (v: string) => void
  currentUserId: number
  onBack: () => void
  onOpenMembers: () => void
  onSend: (e: Event) => void
  onToggleMenu?: () => void
  onInviteToGroup?: () => void
}) {
  const messagesEnd = useRef<HTMLDivElement>(null)

  return (
    <div class="social-chat">
      <SocialChatHeader
        t={t}
        activeChat={activeChat}
        group={group}
        friend={friend}
        members={members}
        onBack={onBack}
        onOpenMembers={onOpenMembers}
        onToggleMenu={onToggleMenu}
        onInviteToGroup={onInviteToGroup}
      />
      <MessagesList
        t={t}
        messages={messages}
        messagesEnd={messagesEnd as RefObject<HTMLDivElement>}
        currentUserId={currentUserId}
      />
      <MessageInput
        t={t}
        value={messageText}
        onChange={setMessageText}
        onSend={onSend}
      />
    </div>
  )
}

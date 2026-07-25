import { useRef } from 'preact/hooks'
import type { RefObject } from 'preact'
import type { Group, GroupMember, GroupMessage } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { GroupChatHeader } from './GroupChatHeader'
import { GroupMessages } from './GroupMessages'
import { GroupMessageInput } from './GroupMessageInput'

export function GroupChat({
  t,
  group,
  members,
  messages,
  messageText,
  setMessageText,
  currentUserId,
  onBack,
  onOpenMembers,
  onSend,
}: {
  t: Messages
  group: Group | null
  members: GroupMember[]
  messages: GroupMessage[]
  messageText: string
  setMessageText: (v: string) => void
  currentUserId: number
  onBack: () => void
  onOpenMembers: () => void
  onSend: (e: Event) => void
}) {
  const messagesEnd = useRef<HTMLDivElement>(null)

  return (
    <div class="group-chat">
      <GroupChatHeader
        t={t}
        group={group}
        members={members}
        onBack={onBack}
        onOpenMembers={onOpenMembers}
      />
      <GroupMessages
        t={t}
        messages={messages}
        messagesEnd={messagesEnd as RefObject<HTMLDivElement>}
        currentUserId={currentUserId}
      />
      <GroupMessageInput
        t={t}
        value={messageText}
        onChange={setMessageText}
        onSend={onSend}
      />
    </div>
  )
}
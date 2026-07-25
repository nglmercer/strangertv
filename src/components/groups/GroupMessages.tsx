import type { RefObject } from 'preact'
import type { GroupMessage } from '../../../shared/types'
import type { Messages } from '../../i18n'

export function GroupMessages({
  t,
  messages,
  messagesEnd,
  currentUserId,
}: {
  t: Messages
  messages: GroupMessage[]
  messagesEnd: RefObject<HTMLDivElement>
  currentUserId: number
}) {
  const isEmpty = messages.length === 0

  return (
    <div class="group-messages" aria-live="polite">
      {isEmpty && <p class="group-messages-empty">{t.noMessages}</p>}
      {messages.map((msg, i) => {
        const mine = msg.senderId === currentUserId
        return (
          <div class={`group-message ${mine ? 'mine' : ''}`} key={`${msg.id}-${i}`}>
            {!mine && msg.sender && (
              <span class="group-message-sender">{msg.sender.email.split('@')[0]}</span>
            )}
            <div class="group-message-bubble">
              <span>{msg.text}</span>
              <small>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
          </div>
        )
      })}
      <div ref={messagesEnd} />
    </div>
  )
}
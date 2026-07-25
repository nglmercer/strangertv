import type { RefObject } from 'preact'
import type { GroupMessage, Message } from '../../../shared/types'
import type { Messages } from '../../i18n'

export function MessagesList({
  t,
  messages,
  messagesEnd,
  currentUserId,
}: {
  t: Messages
  messages: (GroupMessage | Message)[]
  messagesEnd: RefObject<HTMLDivElement>
  currentUserId: number
}) {
  const isEmpty = messages.length === 0

  return (
    <div class="social-messages" aria-live="polite">
      {isEmpty && <p class="social-messages-empty">{t.noMessages}</p>}
      {messages.map((msg, i) => {
        const mine = msg.senderId === currentUserId
        const senderEmail = 'sender' in msg && msg.sender
          ? msg.sender.email.split('@')[0]
          : 'recipientId' in msg && !mine
            ? ''
            : ''
        const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

        return (
          <div class={`social-message ${mine ? 'mine' : ''}`} key={`${msg.id}-${i}`}>
            {!mine && senderEmail && (
              <span class="social-message-sender">{senderEmail}</span>
            )}
            <div class="social-message-bubble">
              <span>{msg.text}</span>
              <small>{time}</small>
            </div>
          </div>
        )
      })}
      <div ref={messagesEnd} />
    </div>
  )
}

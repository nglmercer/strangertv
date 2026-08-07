import { useEffect, useRef } from 'preact/hooks'
import type { Messages } from '../../i18n'
import { icons } from '../icons'
import { Avatar } from './Avatar'
import { displayName } from './ConversationList'
import { EmptyState, ErrorState } from './States'
import type { AnyMessage, LoadState } from '../../hooks/useSocialData'

/** Same calendar day? Used for the date separators. */
function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString()
}

function dayLabel(t: Messages, date: Date): string {
  const now = new Date()
  if (sameDay(date, now)) return t.today
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) return t.yesterday
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const clock = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Messages from the same person within this window share one bubble group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000

export function MessageThread({
  t,
  messages,
  state,
  currentUserId,
  showSenders,
  onRetry,
}: {
  t: Messages
  messages: AnyMessage[]
  state: LoadState
  currentUserId: number
  /** Group chats label who wrote; 1:1 threads don't need it. */
  showSenders: boolean
  onRetry: () => void
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  if (state === 'error') {
    return (
      <div class="thread">
        <ErrorState t={t} onRetry={onRetry} />
      </div>
    )
  }

  if (state !== 'loading' && messages.length === 0) {
    return (
      <div class="thread">
        <EmptyState icon={icons.chatBubble} title={t.noMessages} />
      </div>
    )
  }

  return (
    <div class="thread" aria-live="polite">
      {messages.map((msg, i) => {
        const date = new Date(msg.createdAt)
        const prev = messages[i - 1]
        const prevDate = prev ? new Date(prev.createdAt) : null
        const newDay = !prevDate || !sameDay(prevDate, date)
        const mine = msg.senderId === currentUserId
        const grouped =
          !newDay &&
          prev != null &&
          prev.senderId === msg.senderId &&
          date.getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
        const sender = 'sender' in msg && msg.sender ? displayName(msg.sender.email) : mine ? t.you : ''

        return (
          <div key={`${msg.id}-${i}`}>
            {newDay && (
              <div class="thread-day">
                <span>{dayLabel(t, date)}</span>
              </div>
            )}
            <div class={`bubble-row ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
              {!mine && showSenders && (
                <span class="bubble-avatar">
                  {!grouped && <Avatar name={sender || '?'} size={28} />}
                </span>
              )}
              <div class="bubble-stack">
                {!mine && showSenders && !grouped && sender && <span class="bubble-sender">{sender}</span>}
                <div class="bubble">
                  <span class="bubble-text">{msg.text}</span>
                  <time class="bubble-time" dateTime={msg.createdAt}>
                    {clock(date)}
                  </time>
                </div>
              </div>
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}

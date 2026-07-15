import type { RefObject } from 'preact'
import type { Messages } from '../i18n'
import type { ChatMessage } from '../types/ui'
import type { PageId } from './StaticPages'

export function ChatPanel({
  t,
  chat,
  chatText,
  setChatText,
  matched,
  finding,
  messagesEnd,
  onSend,
  onOpenPage,
}: {
  t: Messages
  chat: ChatMessage[]
  chatText: string
  setChatText: (v: string) => void
  matched: boolean
  finding: boolean
  messagesEnd: RefObject<HTMLDivElement>
  onSend: (e: Event) => void
  onOpenPage: (p: PageId) => void
}) {
  return (
    <div class="chat-box">
      <div class="notice">
        <span class="notice-icon">▣</span>
        <p>
          {t.notice}
          <br />
          <button type="button" class="linkish" onClick={() => onOpenPage('rules')}>
            {t.rules}
          </button>
          {' · '}
          <button type="button" class="linkish" onClick={() => onOpenPage('safety')}>
            ⚠ {t.safety}
          </button>
        </p>
      </div>
      <div class="messages" aria-live="polite">
        {chat.length === 0 && <span class="chat-placeholder">{t.chatPlaceholder}</span>}
        {chat.map((message, i) => (
          <div class={`message ${message.mine ? 'mine' : ''}`} key={`${message.time}-${i}`}>
            <span>{message.text}</span>
            <small>{message.time}</small>
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>
      {(finding || matched) && <p class="shortcuts-hint">{t.shortcuts}</p>}
      <form class="chat-input" onSubmit={onSend}>
        <input
          value={chatText}
          onInput={(e) => setChatText(e.currentTarget.value)}
          disabled={!matched}
          placeholder={matched ? t.writeMessage : t.startToChat}
          maxLength={500}
        />
        <button type="submit" disabled={!matched || !chatText.trim()} aria-label={t.send}>
          ☺
        </button>
      </form>
    </div>
  )
}

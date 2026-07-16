import type { RefObject } from 'preact'
import type { Messages } from '../i18n'
import type { ChatMessage } from '../types/ui'
import type { PageId } from './StaticPages'
import { PAGE_ID } from '../../shared/constants'

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
  appVersion,
  userEmail,
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
  appVersion?: string
  userEmail?: string | null
}) {
  const isEmpty = chat.length === 0

  return (
    <div class="chat-box">
      <div class="notice">
        <p>
          {t.notice}
          {' '}
          <button type="button" class="linkish" onClick={() => onOpenPage(PAGE_ID.rules)}>
            {t.rules}
          </button>
          {' · '}
          <button type="button" class="linkish" onClick={() => onOpenPage(PAGE_ID.safety)}>
            {t.safety}
          </button>
        </p>
      </div>
      <div class="messages" aria-live="polite">
        {isEmpty && (
          <div class="chat-footer-info">
            <span>{t.footerAge}</span>
            <span>
              <button type="button" class="linkish" onClick={() => onOpenPage(PAGE_ID.privacy)}>
                {t.privacy}
              </button>
              {' · '}
              <button type="button" class="linkish" onClick={() => onOpenPage(PAGE_ID.terms)}>
                {t.terms}
              </button>
            </span>
            {appVersion && <span>{t.version}{appVersion}</span>}
            {userEmail && <span>{t.signedInAs} {userEmail}</span>}
          </div>
        )}
        {isEmpty && <span class="chat-placeholder">{t.chatPlaceholder}</span>}
        {chat.map((message, i) => (
          <div class={`message ${message.mine ? 'mine' : ''}`} key={`${message.time}-${i}`}>
            <span>{message.text}</span>
            <small>{message.time}</small>
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>
      <form
        class="chat-input"
        onSubmit={onSend}
        title={finding || matched ? t.shortcuts : undefined}
      >
        <input
          value={chatText}
          onInput={(e) => setChatText(e.currentTarget.value)}
          disabled={!matched}
          placeholder={matched ? t.writeMessage : t.startToChat}
          maxLength={500}
          aria-description={finding || matched ? t.shortcuts : undefined}
        />
        <button type="submit" disabled={!matched || !chatText.trim()} aria-label={t.send}>
          ☺
        </button>
      </form>
    </div>
  )
}

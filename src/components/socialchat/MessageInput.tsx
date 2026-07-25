import type { Messages } from '../../i18n'

export function MessageInput({
  t,
  value,
  onChange,
  onSend,
}: {
  t: Messages
  value: string
  onChange: (v: string) => void
  onSend: (e: Event) => void
}) {
  return (
    <form class="social-message-input" onSubmit={onSend}>
      <input
        type="text"
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        placeholder={t.typeMessage}
        maxLength={500}
        aria-label={t.typeMessage}
      />
      <button type="submit" disabled={!value.trim()} aria-label={t.send}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      </button>
    </form>
  )
}

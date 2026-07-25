import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

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
        <Icon d={icons.paperPlane} />
      </button>
    </form>
  )
}

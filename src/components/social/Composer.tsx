import { useRef, useState } from 'preact/hooks'
import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

const MAX = 500

/**
 * Message box. Grows with the text up to a few lines, sends on Enter (Shift
 * for a newline), and keeps what you typed if the send fails.
 */
export function Composer({ t, onSend }: { t: Messages; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  const submit = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setText('')
    requestAnimationFrame(resize)
    try {
      await onSend(body)
    } catch {
      setText(body)
    } finally {
      setSending(false)
      ref.current?.focus()
    }
  }

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        maxLength={MAX}
        placeholder={t.typeMessage}
        aria-label={t.typeMessage}
        onInput={(e) => {
          setText((e.target as HTMLTextAreaElement).value)
          resize()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <button type="submit" class="composer-send" disabled={!text.trim() || sending} aria-label={t.send} title={t.send}>
        <Icon d={icons.paperPlane} size={18} />
      </button>
    </form>
  )
}

import { useEffect, useRef, useState } from 'preact/hooks'
import type { Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { Modal } from '../Modal'
import { MemberPicker } from './MemberPicker'

/**
 * Create a group: name plus an optional set of friends.
 *
 * Members are picked as full-width toggle rows — the old checkbox layout put
 * the box and the email on separate lines with nothing tying them together.
 */
export function CreateGroupModal({
  t,
  friends,
  onClose,
  onCreate,
}: {
  t: Messages
  friends: Friend[]
  onClose: () => void
  onCreate: (name: string, memberIds: number[]) => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    nameRef.current?.focus()
  }, [])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async (e: Event) => {
    e.preventDefault()
    const value = name.trim()
    if (!value || busy) return
    setBusy(true)
    setFailed(false)
    try {
      await onCreate(value, [...picked])
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="modal social-modal" labelledBy="create-group-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="create-group-title">{t.createGroup}</h2>

      <form onSubmit={submit}>
        <label>
          {t.newGroup}
          <input
            ref={nameRef}
            type="text"
            value={name}
            placeholder={t.groupNamePlaceholder}
            maxLength={100}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>

        <p class="people-heading">
          {t.selectFriends}
          {picked.size > 0 && <span class="count">{picked.size}</span>}
        </p>
        <MemberPicker
          friends={friends}
          picked={picked}
          empty={<p class="people-note">{t.noFriends}</p>}
          onToggle={toggle}
        />

        {failed && <p class="people-note error">{t.genericError}</p>}

        <button type="submit" class="match full" disabled={!name.trim() || busy}>
          {t.createGroup}
        </button>
      </form>
    </Modal>
  )
}

import { useState } from 'preact/hooks'
import type { Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { Modal } from '../Modal'
import { Icon, icons } from '../icons'
import { Avatar } from './Avatar'
import { displayName } from './ConversationList'

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
            type="text"
            value={name}
            placeholder={t.groupNamePlaceholder}
            maxLength={100}
            autofocus
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>

        <p class="people-heading">
          {t.selectFriends}
          {picked.size > 0 && <span class="count">{picked.size}</span>}
        </p>
        {friends.length === 0 ? (
          <p class="people-note">{t.noFriends}</p>
        ) : (
          <div class="pick-list">
            {friends.map((f) => {
              const on = picked.has(f.otherUser.id)
              return (
                <button
                  type="button"
                  key={f.id}
                  class={`pick-row ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggle(f.otherUser.id)}
                >
                  <Avatar name={displayName(f.otherUser.email)} size={30} />
                  <span class="pick-name">{displayName(f.otherUser.email)}</span>
                  <span class="pick-check">{on && <Icon d={icons.check} size={15} />}</span>
                </button>
              )
            })}
          </div>
        )}

        {failed && <p class="people-note error">{t.genericError}</p>}

        <button type="submit" class="match full" disabled={!name.trim() || busy}>
          {t.createGroup}
        </button>
      </form>
    </Modal>
  )
}

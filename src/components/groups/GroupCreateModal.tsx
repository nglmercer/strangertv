import { useState } from 'preact/hooks'
import type { Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'

export function GroupCreateModal({
  t,
  friends,
  onClose,
  onCreate,
}: {
  t: Messages
  friends: Friend[]
  onClose: () => void
  onCreate: (name: string, memberIds: number[]) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (!name.trim() || selected.size === 0) return
    void onCreate(name.trim(), Array.from(selected))
  }

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal group-create-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
        <h2>{t.createGroup}</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            class="group-create-name-input"
            placeholder={t.groupNamePlaceholder}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            maxLength={100}
          />
          <div class="group-create-friends">
            <p class="group-create-friends-label">{t.selectFriends}</p>
            {friends.length === 0 ? (
              <p class="group-create-empty">{t.noFriends}</p>
            ) : (
              <div class="group-create-friends-list">
                {friends.map((f) => (
                  <label class="group-create-friend-item" key={f.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(f.otherUser.id)}
                      onChange={() => toggle(f.otherUser.id)}
                    />
                    <span>{f.otherUser.email}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="submit" class="match full" disabled={!name.trim() || selected.size === 0}>
            {t.createGroup}
          </button>
        </form>
      </div>
    </div>
  )
}
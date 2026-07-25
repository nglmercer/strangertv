import { useState } from 'preact/hooks'
import type { GroupMember, Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'

export function GroupMembersModal({
  t,
  members,
  friends,
  isAdmin,
  currentUserId,
  onClose,
  onAddMembers,
  onRemoveMember,
  onRename,
}: {
  t: Messages
  members: GroupMember[]
  friends: Friend[]
  isAdmin: boolean
  currentUserId: number
  onClose: () => void
  onAddMembers: (userIds: number[]) => void | Promise<void>
  onRemoveMember: (userId: number) => void | Promise<void>
  onRename: (name: string) => void | Promise<void>
}) {
  const [tab, setTab] = useState<'members' | 'add' | 'settings'>('members')
  const [newName, setNewName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const memberIds = new Set(members.map((m) => m.userId))
  const availableFriends = friends.filter((f) => !memberIds.has(f.otherUser.id))

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = () => {
    if (selected.size === 0) return
    void onAddMembers(Array.from(selected))
    setSelected(new Set())
    setTab('members')
  }

  const handleRename = (e: Event) => {
    e.preventDefault()
    if (!newName.trim()) return
    void onRename(newName.trim())
    setNewName('')
  }

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal group-members-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
        <h2>{t.members}</h2>

        <div class="group-members-tabs">
          <button
            type="button"
            class={`group-members-tab ${tab === 'members' ? 'on' : ''}`}
            onClick={() => setTab('members')}
          >
            {t.members}
          </button>
          {isAdmin && (
            <button
              type="button"
              class={`group-members-tab ${tab === 'add' ? 'on' : ''}`}
              onClick={() => setTab('add')}
            >
              {t.addMembers}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              class={`group-members-tab ${tab === 'settings' ? 'on' : ''}`}
              onClick={() => setTab('settings')}
            >
              {t.settings}
            </button>
          )}
        </div>

        {tab === 'members' && (
          <div class="group-members-list">
            {members.map((m) => (
              <div class="group-member-item" key={m.id}>
                <div class="group-member-info">
                  <span class="group-member-email">{m.user.email}</span>
                  {m.role === 'admin' && <span class="group-member-role">{t.createGroup}</span>}
                  {m.userId === currentUserId && <span class="group-member-you">({t.signedInAs})</span>}
                </div>
                {isAdmin && m.userId !== currentUserId && (
                  <button
                    type="button"
                    class="group-member-remove"
                    onClick={() => void onRemoveMember(m.userId)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'add' && isAdmin && (
          <div class="group-members-add">
            {availableFriends.length === 0 ? (
              <p class="group-create-empty">{t.noFriends}</p>
            ) : (
              <>
                <div class="group-create-friends-list">
                  {availableFriends.map((f) => (
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
                <button
                  type="button"
                  class="match full"
                  disabled={selected.size === 0}
                  onClick={handleAdd}
                >
                  {t.addMembers}
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'settings' && isAdmin && (
          <form class="group-settings-form" onSubmit={handleRename}>
            <label class="group-settings-label">{t.renameGroup}</label>
            <div class="group-settings-row">
              <input
                type="text"
                placeholder={t.groupNamePlaceholder}
                value={newName}
                onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
                maxLength={100}
              />
              <button type="submit" disabled={!newName.trim()}>
                {t.save}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
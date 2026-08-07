import { useState } from 'preact/hooks'
import type { Friend, Group, GroupMember } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { useConfirm } from '../ConfirmDialog'
import { Icon, icons } from '../icons'
import { Avatar } from './Avatar'
import { displayName } from './ConversationList'
import { ErrorState, ListSkeleton } from './States'
import type { LoadState } from '../../hooks/useSocialData'

/**
 * Group info as a side sheet next to the thread rather than a modal: members,
 * adding people, renaming, and leaving all stay on one scrollable surface.
 *
 * (The modal this replaces had three tabs whose panels rendered nothing when a
 * member load failed, so it opened empty with no explanation.)
 */
export function GroupSheet({
  t,
  group,
  members,
  membersState,
  friends,
  currentUserId,
  onClose,
  onAddMembers,
  onRemoveMember,
  onRename,
  onLeave,
  onRetry,
}: {
  t: Messages
  group: Group
  members: GroupMember[]
  membersState: LoadState
  friends: Friend[]
  currentUserId: number
  onClose: () => void
  onAddMembers: (userIds: number[]) => Promise<void>
  onRemoveMember: (userId: number) => Promise<void>
  onRename: (name: string) => Promise<void>
  onLeave: () => Promise<void>
  onRetry: () => void
}) {
  const isAdmin = group.myRole === 'admin'
  const [name, setName] = useState(group.name)
  const [adding, setAdding] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmUi, confirm] = useConfirm(t)

  /** Runs an action, surfacing failures instead of leaving the sheet inert. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const memberIds = new Set(members.map((m) => m.userId))
  const addable = friends.filter((f) => !memberIds.has(f.otherUser.id))

  const toggle = (id: number) =>
    setAdding((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submitAdd = async () => {
    if (adding.size === 0) return
    await run(async () => {
      await onAddMembers([...adding])
      setAdding(new Set())
    })
  }

  const submitRename = async (e: Event) => {
    e.preventDefault()
    const next = name.trim()
    if (!next || next === group.name) return
    await run(() => onRename(next))
  }

  return (
    <aside class="group-sheet" aria-label={t.groupInfo}>
      {confirmUi}
      <header class="group-sheet-top">
        <h2>{t.groupInfo}</h2>
        <button type="button" class="icon-btn" onClick={onClose} aria-label={t.close}>
          <Icon d={icons.close} size={18} />
        </button>
      </header>

      <div class="group-sheet-body">
        <div class="group-sheet-identity">
          <Avatar name={group.name} kind="group" size={56} />
          {isAdmin ? (
            <form class="group-rename" onSubmit={submitRename}>
              <input
                type="text"
                value={name}
                maxLength={100}
                aria-label={t.renameGroup}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
              <button type="submit" class="social-btn" disabled={busy || !name.trim() || name.trim() === group.name}>
                {t.saveShort}
              </button>
            </form>
          ) : (
            <p class="group-sheet-name">{group.name}</p>
          )}
        </div>

        <section class="group-sheet-section">
          <h3 class="people-heading">
            {t.members} <span class="count">{members.length}</span>
          </h3>
          {membersState === 'loading' && members.length === 0 && <ListSkeleton rows={3} />}
          {membersState === 'error' && <ErrorState t={t} onRetry={onRetry} />}
          {members.map((m) => (
            <div class="people-row" key={m.id}>
              <Avatar name={displayName(m.user.email)} size={34} />
              <span class="people-row-text">
                <span class="people-row-name">
                  <span class="people-row-label">{displayName(m.user.email)}</span>
                  {m.userId === currentUserId && <span class="tag">{t.you}</span>}
                  {m.role === 'admin' && <span class="tag tag-admin">{t.groupAdmin}</span>}
                </span>
                <span class="people-row-sub">{m.user.email}</span>
              </span>
              {isAdmin && m.userId !== currentUserId && (
                <button
                  type="button"
                  class="icon-btn danger"
                  title={t.removeMember}
                  aria-label={t.removeMember}
                  onClick={() => {
                    void confirm({
                      title: t.removeMemberTitle,
                      message: t.confirmRemoveMember,
                      confirmLabel: t.removeMember,
                      danger: true,
                    }).then((ok) => { if (ok) void run(() => onRemoveMember(m.userId)) })
                  }}
                >
                  <Icon d={icons.userX} size={16} />
                </button>
              )}
            </div>
          ))}
        </section>

        {isAdmin && (
          <section class="group-sheet-section">
            <h3 class="people-heading">{t.addMembers}</h3>
            {addable.length === 0 ? (
              <p class="people-note">{t.noFriends}</p>
            ) : (
              <>
                <div class="pick-list">
                  {addable.map((f) => {
                    const on = adding.has(f.otherUser.id)
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
                <button type="button" class="social-btn accent full" disabled={adding.size === 0 || busy} onClick={() => void submitAdd()}>
                  {t.addMembers}
                  {adding.size > 0 ? ` (${adding.size})` : ''}
                </button>
              </>
            )}
          </section>
        )}

        {failed && <p class="people-note error">{t.genericError}</p>}

        <section class="group-sheet-section">
          <button
            type="button"
            class="social-btn danger full"
            disabled={busy}
            onClick={() => {
              void confirm({
                title: t.leaveGroupTitle,
                message: t.confirmLeaveGroup,
                confirmLabel: t.leaveGroup,
                danger: true,
              }).then((ok) => { if (ok) void run(onLeave) })
            }}
          >
            <Icon d={icons.signOut} size={16} />
            {t.leaveGroup}
          </button>
        </section>
      </div>
    </aside>
  )
}

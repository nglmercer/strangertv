import { useRef, useState } from 'preact/hooks'
import type { Friend, Group, GroupMember } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { mediaApi } from '../../api'
import { useConfirm } from '../ConfirmDialog'
import { Icon, icons } from '../icons'
import { Markdown } from '../Markdown'
import { Avatar } from './Avatar'
import { MemberPicker } from './MemberPicker'
import { PersonRow } from './PersonRow'
import { ErrorState, ListSkeleton } from './States'
import { userDisplayName } from './people'
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
  onUpdate,
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
  onUpdate: (patch: { name?: string; description?: string; image?: number | null }) => Promise<void>
  onLeave: () => Promise<void>
  onRetry: () => void
}) {
  const isAdmin = group.myRole === 'admin'
  const [name, setName] = useState(group.name)
  const [descDraft, setDescDraft] = useState(group.description ?? '')
  const [descEditing, setDescEditing] = useState(false)
  const [adding, setAdding] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [confirmUi, confirm] = useConfirm(t)
  const fileRef = useRef<HTMLInputElement>(null)

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
    await run(() => onUpdate({ name: next }))
  }

  const submitDescription = async (e: Event) => {
    e.preventDefault()
    const next = descDraft.trim()
    if (next === (group.description ?? '')) {
      setDescEditing(false)
      return
    }
    await run(async () => {
      await onUpdate({ description: next })
      setDescEditing(false)
    })
  }

  const uploadPhoto = async (file: File | undefined) => {
    if (!file || photoBusy) return
    setPhotoBusy(true)
    setFailed(false)
    const res = await mediaApi.uploadFile('group', file)
    if (!res.ok) {
      setPhotoBusy(false)
      setFailed(true)
      return
    }
    try {
      await onUpdate({ image: res.upload.id })
    } catch {
      // The patch failed: drop the orphaned blob instead of leaking it.
      await mediaApi.remove(res.upload.id).catch(() => {})
      setFailed(true)
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = async () => {
    if (photoBusy) return
    setPhotoBusy(true)
    setFailed(false)
    try {
      await onUpdate({ image: null })
    } catch {
      setFailed(true)
    } finally {
      setPhotoBusy(false)
    }
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
          <div class="group-photo">
            <Avatar name={group.name} kind="group" size={56} src={group.imageUrl} />
            {isAdmin && (
              <button
                type="button"
                class="group-photo-edit"
                title={t.changePhoto}
                aria-label={t.changePhoto}
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
              >
                <Icon d={icons.camOn} size={14} />
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void uploadPhoto(e.currentTarget.files?.[0])
              e.currentTarget.value = ''
            }}
          />
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
        {isAdmin && group.imageUrl && (
          <button type="button" class="link-btn danger-text" disabled={photoBusy} onClick={() => void removePhoto()}>
            {t.removePhoto}
          </button>
        )}

        <section class="group-sheet-section">
          <h3 class="people-heading">{t.groupDescription}</h3>
          {isAdmin && descEditing ? (
            <form class="group-desc-form" onSubmit={submitDescription}>
              <textarea
                value={descDraft}
                maxLength={500}
                rows={3}
                placeholder={t.groupDescriptionPlaceholder}
                aria-label={t.groupDescription}
                onInput={(e) => setDescDraft((e.target as HTMLTextAreaElement).value)}
              />
              <div class="group-desc-actions">
                <button type="submit" class="social-btn accent" disabled={busy}>
                  {t.saveShort}
                </button>
                <button
                  type="button"
                  class="social-btn"
                  disabled={busy}
                  onClick={() => {
                    setDescDraft(group.description ?? '')
                    setDescEditing(false)
                  }}
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          ) : (
            <div class="group-desc-view">
              {group.description ? (
                <Markdown block text={group.description} className="md-block" />
              ) : (
                <p class="people-note">{isAdmin ? t.groupDescriptionPlaceholder : ''}</p>
              )}
              {isAdmin && !descEditing && (
                <button
                  type="button"
                  class="link-btn"
                  onClick={() => {
                    setDescDraft(group.description ?? '')
                    setDescEditing(true)
                  }}
                >
                  {group.description ? t.edit : t.add}
                </button>
              )}
            </div>
          )}
        </section>

        <section class="group-sheet-section">
          <h3 class="people-heading">
            {t.members} <span class="count">{members.length}</span>
          </h3>
          {membersState === 'loading' && members.length === 0 && <ListSkeleton rows={3} />}
          {membersState === 'error' && <ErrorState t={t} onRetry={onRetry} />}
          {members.map((m) => (
            <PersonRow
              key={m.id}
              avatar={<Avatar name={userDisplayName(m.user)} size={34} />}
              name={
                <>
                  <span class="people-row-label">{userDisplayName(m.user)}</span>
                  {m.userId === currentUserId && <span class="tag">{t.you}</span>}
                  {m.role === 'admin' && <span class="tag tag-admin">{t.groupAdmin}</span>}
                </>
              }
              sub={m.user.email}
              actions={
                isAdmin && m.userId !== currentUserId ? (
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
                ) : undefined
              }
            />
          ))}
        </section>

        {isAdmin && (
          <section class="group-sheet-section">
            <h3 class="people-heading">{t.addMembers}</h3>
            <MemberPicker
              friends={addable}
              picked={adding}
              empty={<p class="people-note">{t.noFriends}</p>}
              onToggle={toggle}
            />
            {addable.length > 0 && (
              <button type="button" class="social-btn accent full" disabled={adding.size === 0 || busy} onClick={() => void submitAdd()}>
                {t.addMembers}
                {adding.size > 0 ? ` (${adding.size})` : ''}
              </button>
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

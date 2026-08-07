import { useState } from 'preact/hooks'
import type { Friend, GroupInvite } from '../../../shared/types'
// The search endpoint returns the client-side PublicUser (nullable birthDate).
import { friendsApi, type PublicUser } from '../../api'
import type { Messages } from '../../i18n'
import { useSocialStore } from '../../store/socialStore'
import { useConfirm } from '../ConfirmDialog'
import { Icon, icons } from '../icons'
import { Avatar } from './Avatar'
import { displayName } from './ConversationList'
import { EmptyState, ErrorState, ListSkeleton } from './States'
import type { ChatId, LoadState } from '../../hooks/useSocialData'

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; user: PublicUser }
  | { kind: 'missing' }
  | { kind: 'sent' }

/**
 * People tab: add someone by email, answer pending friend requests and group
 * invites, then the friend roster. Everything that used to live in a separate
 * modal is here, in the order you need it.
 */
export function PeoplePanel({
  t,
  friends,
  incoming,
  outgoing,
  invites,
  state,
  currentUserId,
  onOpenChat,
  onRespondFriend,
  onRespondInvite,
  onRemoveFriend,
  onRetry,
}: {
  t: Messages
  friends: Friend[]
  incoming: Friend[]
  outgoing: Friend[]
  invites: GroupInvite[]
  state: LoadState
  currentUserId: number
  onOpenChat: (chat: ChatId) => void
  onRespondFriend: (friendId: number, action: 'accept' | 'decline') => Promise<void>
  onRespondInvite: (inviteId: number, action: 'accept' | 'decline') => Promise<void>
  onRemoveFriend: (friendId: number, otherUserId: number) => Promise<void>
  onRetry: () => void
}) {
  const [email, setEmail] = useState('')
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const [busy, setBusy] = useState<number | null>(null)
  const store = useSocialStore()
  const [confirmUi, confirm] = useConfirm(t)

  const runSearch = async (e: Event) => {
    e.preventDefault()
    const value = email.trim()
    if (!value) return
    setSearch({ kind: 'searching' })
    try {
      const { user } = await friendsApi.search(value)
      setSearch(user && user.id !== currentUserId ? { kind: 'found', user } : { kind: 'missing' })
    } catch {
      setSearch({ kind: 'missing' })
    }
  }

  const sendRequest = async (user: PublicUser) => {
    setBusy(user.id)
    try {
      await friendsApi.request(user.id)
      setSearch({ kind: 'sent' })
      setEmail('')
    } catch {
      setSearch({ kind: 'missing' })
    } finally {
      setBusy(null)
    }
  }

  const relationOf = (user: PublicUser) => {
    if (friends.some((f) => f.otherUser.id === user.id)) return 'friend'
    if ([...incoming, ...outgoing].some((f) => f.otherUser.id === user.id)) return 'pending'
    return 'none'
  }

  if (state === 'error') return <ErrorState t={t} onRetry={onRetry} />

  return (
    <div class="people-panel">
      {confirmUi}
      <section class="people-section">
        <h3 class="people-heading">{t.addFriendTitle}</h3>
        <form class="people-search" onSubmit={runSearch}>
          <input
            type="email"
            value={email}
            placeholder={t.searchFriends}
            aria-label={t.searchFriends}
            onInput={(e) => {
              setEmail((e.target as HTMLInputElement).value)
              setSearch({ kind: 'idle' })
            }}
          />
          <button type="submit" class="social-btn" disabled={!email.trim() || search.kind === 'searching'}>
            {t.search}
          </button>
        </form>

        {search.kind === 'missing' && <p class="people-note error">{t.searchFailed}</p>}
        {search.kind === 'sent' && <p class="people-note ok">{t.friendRequestSent}</p>}
        {search.kind === 'found' && (
          <div class="people-row">
            <Avatar name={displayName(search.user.email)} size={36} />
            <span class="people-row-text">
              <span class="people-row-name">{displayName(search.user.email)}</span>
              <span class="people-row-sub">{search.user.email}</span>
            </span>
            {relationOf(search.user) === 'friend' ? (
              <span class="people-note">{t.alreadyFriend}</span>
            ) : relationOf(search.user) === 'pending' ? (
              <span class="people-note">{t.requestPending}</span>
            ) : (
              <button
                type="button"
                class="social-btn accent"
                disabled={busy === search.user.id}
                onClick={() => void sendRequest(search.user)}
              >
                {t.sendRequest}
              </button>
            )}
          </div>
        )}
        {search.kind === 'idle' && <p class="people-note">{t.addFriendHint}</p>}
      </section>

      {incoming.length > 0 && (
        <section class="people-section">
          <h3 class="people-heading">
            {t.pendingRequests} <span class="count">{incoming.length}</span>
          </h3>
          {incoming.map((f) => (
            <div class="people-row" key={f.id}>
              <Avatar name={displayName(f.otherUser.email)} size={36} />
              <span class="people-row-text">
                <span class="people-row-name">{displayName(f.otherUser.email)}</span>
                <span class="people-row-sub">{f.otherUser.email}</span>
              </span>
              <span class="people-row-actions">
                <button
                  type="button"
                  class="icon-btn ok"
                  title={t.accept}
                  aria-label={t.accept}
                  disabled={busy === f.id}
                  onClick={() => {
                    setBusy(f.id)
                    void onRespondFriend(f.id, 'accept').finally(() => setBusy(null))
                  }}
                >
                  <Icon d={icons.check} size={16} />
                </button>
                <button
                  type="button"
                  class="icon-btn danger"
                  title={t.decline}
                  aria-label={t.decline}
                  disabled={busy === f.id}
                  onClick={() => {
                    setBusy(f.id)
                    void onRespondFriend(f.id, 'decline').finally(() => setBusy(null))
                  }}
                >
                  <Icon d={icons.close} size={16} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      {invites.length > 0 && (
        <section class="people-section">
          <h3 class="people-heading">
            {t.groupInvites} <span class="count">{invites.length}</span>
          </h3>
          {invites.map((invite) => (
            <div class="people-row" key={invite.id}>
              <Avatar name={invite.groupName} kind="group" size={36} />
              <span class="people-row-text">
                <span class="people-row-name">{invite.groupName}</span>
                <span class="people-row-sub">
                  {invite.inviterUser ? `${displayName(invite.inviterUser.email)} ${t.invitedYouTo}` : t.groupInvites}
                </span>
              </span>
              <span class="people-row-actions">
                <button
                  type="button"
                  class="icon-btn ok"
                  title={t.accept}
                  aria-label={t.accept}
                  onClick={() => void onRespondInvite(invite.id, 'accept')}
                >
                  <Icon d={icons.check} size={16} />
                </button>
                <button
                  type="button"
                  class="icon-btn danger"
                  title={t.decline}
                  aria-label={t.decline}
                  onClick={() => void onRespondInvite(invite.id, 'decline')}
                >
                  <Icon d={icons.close} size={16} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section class="people-section">
          <h3 class="people-heading">{t.sentRequests}</h3>
          {outgoing.map((f) => (
            <div class="people-row is-muted" key={f.id}>
              <Avatar name={displayName(f.otherUser.email)} size={36} />
              <span class="people-row-text">
                <span class="people-row-name">{displayName(f.otherUser.email)}</span>
                <span class="people-row-sub">{t.requestPending}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      <section class="people-section">
        <h3 class="people-heading">
          {t.friends} {friends.length > 0 && <span class="count">{friends.length}</span>}
        </h3>
        {state === 'loading' && friends.length === 0 && <ListSkeleton rows={3} />}
        {state === 'ready' && friends.length === 0 && (
          <EmptyState icon={icons.userPlus} title={t.noFriends} />
        )}
        {friends.map((f) => {
          const online = store.isOnline(f.otherUser.id)
          return (
            <div class="people-row" key={f.id}>
              <Avatar
                name={displayName(f.otherUser.email)}
                size={36}
                presence={online ? 'online' : 'offline'}
              />
              <button type="button" class="people-row-text as-button" onClick={() => onOpenChat({ kind: 'friend', id: f.otherUser.id })}>
                <span class="people-row-name">{displayName(f.otherUser.email)}</span>
                <span class="people-row-sub">{online ? t.online : t.presenceOffline}</span>
              </button>
              <span class="people-row-actions">
                <button
                  type="button"
                  class="icon-btn"
                  title={t.send}
                  aria-label={t.send}
                  onClick={() => onOpenChat({ kind: 'friend', id: f.otherUser.id })}
                >
                  <Icon d={icons.chatBubble} size={16} />
                </button>
                <button
                  type="button"
                  class="icon-btn danger"
                  title={t.unfriend}
                  aria-label={t.unfriend}
                  onClick={() => {
                    void confirm({
                      title: t.removeFriendTitle,
                      message: t.removeFriendConfirm,
                      confirmLabel: t.unfriend,
                      danger: true,
                    }).then((ok) => { if (ok) void onRemoveFriend(f.id, f.otherUser.id) })
                  }}
                >
                  <Icon d={icons.userX} size={16} />
                </button>
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}

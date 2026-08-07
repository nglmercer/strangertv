import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { Friend, Group } from '../../../shared/types'
import { formatMessage, type Messages } from '../../i18n'
import { socialStore, useSocialStore } from '../../store/socialStore'
import { Icon, icons } from '../icons'
import { Avatar } from './Avatar'
import { EmptyState, ErrorState, ListSkeleton } from './States'
import type { ChatId, LoadState } from '../../hooks/useSocialData'

export const displayName = (email: string) => email.split('@')[0] ?? email

function match(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/**
 * Left pane: one merged list of conversations (groups and direct messages),
 * filtered by a single search box. People/requests live behind their own tab so
 * the default view stays a plain list of who you talk to.
 */
export function ConversationList({
  t,
  groups,
  friends,
  active,
  state,
  requestCount,
  tab,
  onTabChange,
  onOpen,
  onCreateGroup,
  onRetry,
  people,
}: {
  t: Messages
  groups: Group[]
  friends: Friend[]
  active: ChatId | null
  state: LoadState
  requestCount: number
  tab: 'chats' | 'people'
  onTabChange: (tab: 'chats' | 'people') => void
  onOpen: (chat: ChatId) => void
  onCreateGroup: () => void
  onRetry: () => void
  /** Body of the People tab, rendered inside the same pane. */
  people: ComponentChildren
}) {
  const [query, setQuery] = useState('')
  const store = useSocialStore()
  // `store` is a stable instance, so the memo has to watch its version counter
  // to pick up presence and unread changes.
  const storeVersion = store.version

  const rows = useMemo(() => {
    const groupRows = groups.map((g) => ({
      key: `group:${g.id}`,
      chat: { kind: 'group' as const, id: g.id },
      name: g.name,
      sub:
        g.memberCount === 1
          ? t.memberCountOne
          : formatMessage(t.memberCount, { count: g.memberCount ?? 0 }),
      kind: 'group' as const,
      presence: undefined,
    }))
    const friendRows = friends.map((f) => {
      const online = store.isOnline(f.otherUser.id)
      return {
        key: `friend:${f.otherUser.id}`,
        chat: { kind: 'friend' as const, id: f.otherUser.id },
        name: displayName(f.otherUser.email),
        sub: online ? t.online : t.presenceOffline,
        kind: 'user' as const,
        presence: (online ? 'online' : 'offline') as 'online' | 'offline',
      }
    })
    const all = [...groupRows, ...friendRows]
    const q = query.trim()
    return q ? all.filter((r) => match(r.name, q)) : all
  }, [groups, friends, query, store, storeVersion, t])

  return (
    <aside class="social-pane">
      <div class="social-pane-top">
        <div class="segmented" role="tablist" aria-label={t.social}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chats'}
            class={`segment ${tab === 'chats' ? 'on' : ''}`}
            onClick={() => onTabChange('chats')}
          >
            {t.chats}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'people'}
            class={`segment ${tab === 'people' ? 'on' : ''}`}
            onClick={() => onTabChange('people')}
          >
            {t.people}
            {requestCount > 0 && <span class="segment-badge">{requestCount > 9 ? '9+' : requestCount}</span>}
          </button>
        </div>
        <button type="button" class="icon-btn accent" onClick={onCreateGroup} title={t.newGroup} aria-label={t.newGroup}>
          <Icon d={icons.plus} size={18} />
        </button>
      </div>

      {tab === 'chats' && (
        <>
          <div class="social-search">
            <Icon d={icons.search} size={15} />
            <input
              type="search"
              value={query}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </div>

          <div class="social-scroll">
            {state === 'loading' && rows.length === 0 && <ListSkeleton />}
            {state === 'error' && <ErrorState t={t} onRetry={onRetry} />}
            {state === 'ready' && rows.length === 0 && (
              <EmptyState
                icon={icons.chatBubble}
                title={query ? t.noResults : t.noConversations}
                hint={query ? undefined : t.noConversationsHint}
              />
            )}
            {rows.map((row) => {
              const unread = socialStore.getUnread(row.key)
              const isActive = active?.kind === row.chat.kind && active.id === row.chat.id
              return (
                <button
                  type="button"
                  key={row.key}
                  class={`social-row ${isActive ? 'on' : ''}`}
                  aria-current={isActive}
                  onClick={() => onOpen(row.chat)}
                >
                  <Avatar name={row.name} kind={row.kind} presence={row.presence} />
                  <span class="social-row-text">
                    <span class="social-row-name">{row.name}</span>
                    <span class="social-row-sub">{row.sub}</span>
                  </span>
                  {unread > 0 && <span class="unread-badge">{unread > 9 ? '9+' : unread}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}

      {tab === 'people' && <div class="social-scroll">{people}</div>}
    </aside>
  )
}

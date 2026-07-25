import { useState } from 'preact/hooks'
import type { Group, Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'

type Tab = 'groups' | 'friends'

interface ActiveChat {
  type: 'group' | 'friend'
  id: number
}

export function SocialSidebar({
  t,
  groups,
  friends,
  activeChat,
  onSelectGroup,
  onSelectFriend,
  onCreateGroup,
}: {
  t: Messages
  groups: Group[]
  friends: Friend[]
  activeChat: ActiveChat | null
  onSelectGroup: (id: number) => void
  onSelectFriend: (id: number) => void
  onCreateGroup: () => void
}) {
  const [tab, setTab] = useState<Tab>('groups')

  return (
    <div class="social-sidebar">
      <div class="social-sidebar-header">
        <div class="social-tabs">
          <button
            type="button"
            class={`social-tab ${tab === 'groups' ? 'active' : ''}`}
            onClick={() => setTab('groups')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {t.yourGroups}
          </button>
          <button
            type="button"
            class={`social-tab ${tab === 'friends' ? 'active' : ''}`}
            onClick={() => setTab('friends')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {t.friends}
          </button>
        </div>
        {tab === 'groups' && (
          <button type="button" class="social-sidebar-new" onClick={onCreateGroup} aria-label={t.newGroup}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {tab === 'groups' && (
        <div class="social-list">
          {groups.length === 0 ? (
            <p class="social-empty">{t.noGroups}</p>
          ) : (
            groups.map((group) => (
              <button
                type="button"
                class={`social-item ${activeChat?.type === 'group' && activeChat.id === group.id ? 'active' : ''}`}
                key={group.id}
                onClick={() => onSelectGroup(group.id)}
              >
                <div class="social-item-avatar group-avatar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div class="social-item-info">
                  <span class="social-item-name">{group.name}</span>
                  <span class="social-item-sub">
                    {group.memberCount} {t.members}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {tab === 'friends' && (
        <div class="social-list">
          {friends.length === 0 ? (
            <p class="social-empty">{t.noFriends}</p>
          ) : (
            friends.map((friend) => (
              <button
                type="button"
                class={`social-item ${activeChat?.type === 'friend' && activeChat.id === friend.otherUser.id ? 'active' : ''}`}
                key={friend.id}
                onClick={() => onSelectFriend(friend.otherUser.id)}
              >
                <div class="social-item-avatar friend-avatar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span class="online-dot" />
                </div>
                <div class="social-item-info">
                  <span class="social-item-name">{friend.otherUser.email.split('@')[0]}</span>
                  <span class="social-item-sub">{friend.otherUser.email}</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

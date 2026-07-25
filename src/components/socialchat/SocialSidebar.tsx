import { useState, useEffect } from 'preact/hooks'
import type { Group, Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { socialStore } from '../../store/socialStore'
import { Icon, icons } from '../icons'

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
            <Icon d={icons.users} size={16} />
            {t.yourGroups}
          </button>
          <button
            type="button"
            class={`social-tab ${tab === 'friends' ? 'active' : ''}`}
            onClick={() => setTab('friends')}
          >
            <Icon d={icons.user} size={16} />
            {t.friends}
          </button>
        </div>
        {tab === 'groups' && (
          <button type="button" class="social-sidebar-new" onClick={onCreateGroup} aria-label={t.newGroup}>
            <Icon d={icons.plus} size={18} />
          </button>
        )}
      </div>

      {tab === 'groups' && (
        <div class="social-list">
          {groups.length === 0 ? (
            <p class="social-empty">{t.noGroups}</p>
          ) : (
            groups.map((group) => {
              const unread = socialStore.getUnread(`group:${group.id}`)
              return (
                <button
                  type="button"
                  class={`social-item ${activeChat?.type === 'group' && activeChat.id === group.id ? 'active' : ''}`}
                  key={group.id}
                  onClick={() => onSelectGroup(group.id)}
                >
                  <div class="social-item-avatar group-avatar">
                    <Icon d={icons.users} size={18} />
                  </div>
                  <div class="social-item-info">
                    <span class="social-item-name">{group.name}</span>
                    <span class="social-item-sub">
                      {group.memberCount} {t.members}
                    </span>
                  </div>
                  {unread > 0 && <span class="social-unread-badge">{unread > 9 ? '9+' : unread}</span>}
                </button>
              )
            })
          )}
        </div>
      )}

      {tab === 'friends' && (
        <div class="social-list">
          {friends.length === 0 ? (
            <p class="social-empty">{t.noFriends}</p>
          ) : (
            friends.map((friend) => {
              const online = socialStore.isOnline(friend.otherUser.id)
              const unread = socialStore.getUnread(`friend:${friend.otherUser.id}`)
              return (
                <button
                  type="button"
                  class={`social-item ${activeChat?.type === 'friend' && activeChat.id === friend.otherUser.id ? 'active' : ''}`}
                  key={friend.id}
                  onClick={() => onSelectFriend(friend.otherUser.id)}
                >
                  <div class={`social-item-avatar friend-avatar ${online ? 'is-online' : 'is-offline'}`}>
                    <Icon d={icons.user} size={18} />
                    <span class={`presence-dot ${online ? 'online' : 'offline'}`} />
                  </div>
                  <div class="social-item-info">
                    <span class="social-item-name">{friend.otherUser.email.split('@')[0]}</span>
                    <span class="social-item-sub">
                      {online ? t.online : friend.otherUser.email}
                    </span>
                  </div>
                  {unread > 0 && <span class="social-unread-badge">{unread > 9 ? '9+' : unread}</span>}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

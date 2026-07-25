import { useState, useEffect, useCallback } from 'preact/hooks'
import type { Group, GroupMember, GroupMessage, Friend, Message } from '../../../shared/types'
import type { Messages } from '../../i18n'
import type { useMatchSocket } from '../../hooks/useMatchSocket'
import { groupsApi, friendsApi, messagesApi, onGroupMessage } from '../../api'
import { socialStore } from '../../store/socialStore'
import { SocialSidebar } from './SocialSidebar'
import { SocialChat } from './SocialChat'
import { GroupCreateModal } from '../groups/GroupCreateModal'
import { GroupMembersModal } from '../groups/GroupMembersModal'
import { GroupInviteModal } from './GroupInviteModal'
import { Icon, icons } from '../icons'

type ActiveChat =
  | { type: 'group'; id: number }
  | { type: 'friend'; id: number }

type MatchSocket = ReturnType<typeof useMatchSocket>

export function SocialChatApp({
  t,
  currentUserId,
  match,
}: {
  t: Messages
  currentUserId: number
  match: MatchSocket | null
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([])
  const [friendMessages, setFriendMessages] = useState<Message[]>([])
  const [messageText, setMessageText] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteFriendId, setInviteFriendId] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [error, setError] = useState('')

  const activeGroup = activeChat?.type === 'group' ? groups.find((g) => g.id === activeChat.id) ?? null : null
  const activeFriend = activeChat?.type === 'friend' ? friends.find((f) => f.otherUser.id === activeChat.id) ?? null : null
  const isAdmin = activeGroup?.myRole === 'admin'

  const messages: (GroupMessage | Message)[] = activeChat?.type === 'group' ? groupMessages : friendMessages

  const loadGroups = useCallback(async () => {
    try {
      const { groups: list } = await groupsApi.list()
      setGroups(list)
    } catch {
      setError(t.genericError)
    }
  }, [t.genericError])

  const loadFriends = useCallback(async () => {
    try {
      const { friends: list } = await friendsApi.list()
      const accepted = list.filter((f) => f.status === 'accepted')
      setFriends(accepted)
    } catch {
      /* ignore */
    }
  }, [])

  const loadMembers = useCallback(async (groupId: number) => {
    try {
      const { members: list } = await groupsApi.getMembers(groupId)
      setMembers(list)
    } catch {
      /* ignore */
    }
  }, [])

  const loadGroupMessages = useCallback(async (groupId: number) => {
    try {
      const { messages: list } = await groupsApi.getMessages(groupId, 50)
      setGroupMessages(list)
    } catch {
      /* ignore */
    }
  }, [])

  const loadFriendMessages = useCallback(async (friendId: number) => {
    try {
      const { messages: list } = await messagesApi.getConversation(friendId, 50)
      setFriendMessages(list)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadGroups()
    void loadFriends()
  }, [loadGroups, loadFriends])

  useEffect(() => {
    if (activeChat?.type === 'group') {
      void loadMembers(activeChat.id)
      void loadGroupMessages(activeChat.id)
      socialStore.clearUnread(`group:${activeChat.id}`)
    } else if (activeChat?.type === 'friend') {
      void loadFriendMessages(activeChat.id)
      socialStore.clearUnread(`friend:${activeChat.id}`)
    }
  }, [activeChat, loadMembers, loadGroupMessages, loadFriendMessages])

  // WS: group messages
  useEffect(() => {
    return onGroupMessage((msg) => {
      if (activeChat?.type === 'group' && msg.groupId === activeChat.id) {
        setGroupMessages((prev) => [...prev, msg])
      } else {
        socialStore.incrementUnread(`group:${msg.groupId}`)
        const sender = msg.sender
        socialStore.addNotification({
          type: 'group_message',
          title: sender?.email.split('@')[0] ?? 'Group',
          body: msg.text.slice(0, 80),
          from: sender,
          data: { groupId: msg.groupId },
        })
      }
    })
  }, [activeChat])

  // Subscribe to social store for real-time friend messages
  useEffect(() => {
    let lastNotificationCount = 0
    return socialStore.subscribe(() => {
      const notifications = socialStore.notifications
      if (notifications.length > lastNotificationCount) {
        const newOnes = notifications.slice(0, notifications.length - lastNotificationCount)
        for (const n of newOnes) {
          if (n.type === 'message' && n.data?.senderId && activeChat?.type === 'friend' && activeChat.id === n.data.senderId) {
            void (async () => {
              try {
                const { messages } = await messagesApi.getConversation(activeChat.id, 50)
                setFriendMessages(messages)
              } catch { /* ignore */ }
            })()
          }
        }
      }
      lastNotificationCount = notifications.length
    })
  }, [activeChat])

  const handleSelectGroup = (id: number) => {
    setActiveChat({ type: 'group', id })
    setMessageText('')
    setSidebarOpen(false)
  }

  const handleSelectFriend = (id: number) => {
    setActiveChat({ type: 'friend', id })
    setMessageText('')
    setSidebarOpen(false)
  }

  const handleBack = () => {
    setActiveChat(null)
    setGroupMessages([])
    setFriendMessages([])
    setMembers([])
  }

  const handleSend = (e: Event) => {
    e.preventDefault()
    if (!messageText.trim() || !activeChat) return
    const text = messageText.trim()
    setMessageText('')

    if (activeChat.type === 'group') {
      void (async () => {
        try {
          const { message } = await groupsApi.sendMessage(activeChat.id, text)
          setGroupMessages((prev) => [...prev, message])
        } catch {
          setError(t.genericError)
          setMessageText(text)
        }
      })()
    } else {
      void (async () => {
        try {
          const { message } = await messagesApi.send(activeChat.id, text)
          setFriendMessages((prev) => [...prev, message])
        } catch {
          setError(t.genericError)
          setMessageText(text)
        }
      })()
    }
  }

  const handleCreate = async (name: string, memberIds: number[]) => {
    try {
      const { group } = await groupsApi.create(name, memberIds)
      setGroups((prev) => [group, ...prev])
      setShowCreate(false)
      setActiveChat({ type: 'group', id: group.id })
    } catch {
      setError(t.genericError)
    }
  }

  const handleAddMembers = async (userIds: number[]) => {
    if (activeChat?.type !== 'group') return
    try {
      const { members: list } = await groupsApi.addMembers(activeChat.id, userIds)
      setMembers(list)
    } catch {
      setError(t.genericError)
    }
  }

  const handleRemoveMember = async (userId: number) => {
    if (activeChat?.type !== 'group') return
    try {
      await groupsApi.removeMember(activeChat.id, userId)
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
    } catch {
      setError(t.genericError)
    }
  }

  const handleRename = async (name: string) => {
    if (activeChat?.type !== 'group') return
    try {
      await groupsApi.rename(activeChat.id, name)
      setGroups((prev) => prev.map((g) => (g.id === activeChat.id ? { ...g, name } : g)))
    } catch {
      setError(t.genericError)
    }
  }

  const handleOpenInvite = (friendId: number) => {
    setInviteFriendId(friendId)
    setShowInvite(true)
  }

  const handleSelectInviteGroup = (groupId: number) => {
    if (inviteFriendId != null && match) {
      match.groupInvite(groupId, inviteFriendId)
    }
    setShowInvite(false)
    setInviteFriendId(null)
  }

  // Refresh groups when a group invite is accepted/declined
  useEffect(() => {
    return socialStore.subscribe(() => {
      const last = socialStore.notifications[0]
      if (last?.type === 'group_invite') {
        void loadGroups()
      }
    })
  }, [loadGroups])

  return (
    <div class={`social-app ${activeChat ? 'has-active' : ''} ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {sidebarOpen && <div class="social-sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <SocialSidebar
        t={t}
        groups={groups}
        friends={friends}
        activeChat={activeChat}
        onSelectGroup={handleSelectGroup}
        onSelectFriend={handleSelectFriend}
        onCreateGroup={() => setShowCreate(true)}
      />
      <div class="social-main">
        {activeChat && (activeGroup || activeFriend) ? (
          <SocialChat
            t={t}
            activeChat={activeChat}
            group={activeGroup}
            friend={activeFriend}
            members={members}
            messages={messages}
            messageText={messageText}
            setMessageText={setMessageText}
            currentUserId={currentUserId}
            onBack={handleBack}
            onOpenMembers={() => setShowMembers(true)}
            onSend={handleSend}
            onToggleMenu={() => setSidebarOpen((v) => !v)}
            onInviteToGroup={activeChat?.type === 'friend' ? () => handleOpenInvite(activeChat.id) : undefined}
          />
        ) : (
          <div class="social-main-empty">
            <Icon d={icons.chatBubble} size={48} />
            <p>{t.chooseConversation}</p>
          </div>
        )}
      </div>

      {showCreate && (
        <GroupCreateModal
          t={t}
          friends={friends}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {showMembers && activeChat?.type === 'group' && (
        <GroupMembersModal
          t={t}
          members={members}
          friends={friends}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={() => setShowMembers(false)}
          onAddMembers={handleAddMembers}
          onRemoveMember={handleRemoveMember}
          onRename={handleRename}
        />
      )}

      {showInvite && inviteFriendId != null && (
        <GroupInviteModal
          t={t}
          groups={groups}
          friendName={activeFriend?.otherUser.email.split('@')[0] ?? ''}
          onSelect={handleSelectInviteGroup}
          onClose={() => {
            setShowInvite(false)
            setInviteFriendId(null)
          }}
        />
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'preact/hooks'
import type { Group, GroupMember, GroupMessage, Friend } from '../../../shared/types'
import type { Messages } from '../../i18n'
import { groupsApi, friendsApi, onGroupMessage } from '../../api'
import { GroupsSidebar } from './GroupsSidebar'
import { GroupChat } from './GroupChat'
import { GroupCreateModal } from './GroupCreateModal'
import { GroupMembersModal } from './GroupMembersModal'

export function GroupsApp({ t, currentUserId }: { t: Messages; currentUserId: number }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [messageText, setMessageText] = useState('')
  const [friends, setFriends] = useState<Friend[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null
  const isAdmin = activeGroup?.myRole === 'admin'

  const loadGroups = useCallback(async () => {
    try {
      const { groups: list } = await groupsApi.list()
      setGroups(list)
    } catch {
      setError(t.genericError)
    }
  }, [t.genericError])

  const loadMembers = useCallback(async (groupId: number) => {
    try {
      const { members: list } = await groupsApi.getMembers(groupId)
      setMembers(list)
    } catch {
      /* ignore */
    }
  }, [])

  const loadMessages = useCallback(async (groupId: number) => {
    try {
      const { messages: list } = await groupsApi.getMessages(groupId, 50)
      setMessages(list)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadGroups()
    const loadFriendsList = async () => {
      try {
        const { friends: list } = await friendsApi.list()
        setFriends(list.filter((f) => f.status === 'accepted'))
      } catch {
        /* ignore */
      }
    }
    void loadFriendsList()
  }, [loadGroups])

  useEffect(() => {
    if (activeGroupId) {
      void loadMembers(activeGroupId)
      void loadMessages(activeGroupId)
    }
  }, [activeGroupId, loadMembers, loadMessages])

  useEffect(() => {
    return onGroupMessage((msg) => {
      if (msg.groupId === activeGroupId) {
        setMessages((prev) => [...prev, msg])
      }
    })
  }, [activeGroupId])

  const handleSelectGroup = (id: number) => {
    setActiveGroupId(id)
    setMessageText('')
  }

  const handleBack = () => {
    setActiveGroupId(null)
    setMessages([])
    setMembers([])
  }

  const handleSend = (e: Event) => {
    e.preventDefault()
    if (!messageText.trim() || !activeGroupId) return
    const text = messageText.trim()
    setMessageText('')
    void (async () => {
      try {
        const { message } = await groupsApi.sendMessage(activeGroupId, text)
        setMessages((prev) => [...prev, message])
      } catch {
        setError(t.genericError)
        setMessageText(text)
      }
    })()
  }

  const handleCreate = async (name: string, memberIds: number[]) => {
    try {
      const { group } = await groupsApi.create(name, memberIds)
      setGroups((prev) => [group, ...prev])
      setShowCreate(false)
      setActiveGroupId(group.id)
    } catch {
      setError(t.genericError)
    }
  }

  const handleAddMembers = async (userIds: number[]) => {
    if (!activeGroupId) return
    try {
      const { members: list } = await groupsApi.addMembers(activeGroupId, userIds)
      setMembers(list)
    } catch {
      setError(t.genericError)
    }
  }

  const handleRemoveMember = async (userId: number) => {
    if (!activeGroupId) return
    try {
      await groupsApi.removeMember(activeGroupId, userId)
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
    } catch {
      setError(t.genericError)
    }
  }

  const handleRename = async (name: string) => {
    if (!activeGroupId) return
    try {
      await groupsApi.rename(activeGroupId, name)
      setGroups((prev) => prev.map((g) => (g.id === activeGroupId ? { ...g, name } : g)))
    } catch {
      setError(t.genericError)
    }
  }

  return (
    <div class="groups-app">
      <GroupsSidebar
        t={t}
        groups={groups}
        activeGroupId={activeGroupId}
        onSelectGroup={handleSelectGroup}
        onCreateGroup={() => setShowCreate(true)}
      />
      <div class="groups-main">
        {activeGroupId && activeGroup ? (
          <GroupChat
            t={t}
            group={activeGroup}
            members={members}
            messages={messages}
            messageText={messageText}
            setMessageText={setMessageText}
            currentUserId={currentUserId}
            onBack={handleBack}
            onOpenMembers={() => setShowMembers(true)}
            onSend={handleSend}
          />
        ) : (
          <div class="groups-main-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p>{t.yourGroups}</p>
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

      {showMembers && activeGroupId && (
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
    </div>
  )
}
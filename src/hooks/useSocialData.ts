import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { Friend, Group, GroupInvite, GroupMember, GroupMessage, Message, PublicUser } from '../../shared/types'
import { friendsApi, groupInvitesApi, groupsApi, messagesApi, onGroupMessage } from '../api'
import { socialStore } from '../store/socialStore'

export type ChatId = { kind: 'group'; id: number } | { kind: 'friend'; id: number }

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export const chatKey = (chat: ChatId) => `${chat.kind}:${chat.id}`

export type AnyMessage = (GroupMessage | Message) & { sender?: PublicUser }

/**
 * Everything the social section reads and writes, in one place.
 *
 * Each resource carries its own load state so the UI can tell "empty" from
 * "still loading" from "failed" — the previous screens swallowed every error
 * and rendered an empty list, which looked identical to having no data.
 */
export function useSocialData(currentUserId: number) {
  const [groups, setGroups] = useState<Group[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<Friend[]>([])
  const [invites, setInvites] = useState<GroupInvite[]>([])
  const [rosterState, setRosterState] = useState<LoadState>('idle')

  const [active, setActive] = useState<ChatId | null>(null)
  const [messages, setMessages] = useState<AnyMessage[]>([])
  const [messagesState, setMessagesState] = useState<LoadState>('idle')
  const [members, setMembers] = useState<GroupMember[]>([])
  const [membersState, setMembersState] = useState<LoadState>('idle')

  const activeGroup = active?.kind === 'group' ? groups.find((g) => g.id === active.id) ?? null : null
  const activeFriend = active?.kind === 'friend' ? friends.find((f) => f.otherUser.id === active.id) ?? null : null

  // --- roster -------------------------------------------------------------

  const loadRoster = useCallback(async () => {
    setRosterState((s) => (s === 'ready' ? s : 'loading'))
    try {
      const [groupRes, friendRes, inviteRes] = await Promise.all([
        groupsApi.list(),
        friendsApi.list(),
        groupInvitesApi.list().catch(() => ({ invites: [] as GroupInvite[] })),
      ])
      setGroups(groupRes.groups)
      setFriends(friendRes.friends.filter((f) => f.status === 'accepted'))
      setRequests(friendRes.friends.filter((f) => f.status === 'pending'))
      setInvites(inviteRes.invites.filter((i) => i.status === 'pending'))
      setRosterState('ready')
    } catch {
      setRosterState('error')
    }
  }, [])

  useEffect(() => {
    void loadRoster()
  }, [loadRoster])

  // --- active conversation ------------------------------------------------

  const loadMessages = useCallback(async (chat: ChatId) => {
    setMessagesState('loading')
    try {
      const list =
        chat.kind === 'group'
          ? (await groupsApi.getMessages(chat.id, 50)).messages
          : (await messagesApi.getConversation(chat.id, 50)).messages
      setMessages(list)
      setMessagesState('ready')
    } catch {
      setMessagesState('error')
    }
  }, [])

  const loadMembers = useCallback(async (groupId: number) => {
    setMembersState('loading')
    try {
      const { members: list } = await groupsApi.getMembers(groupId)
      setMembers(list)
      setMembersState('ready')
    } catch {
      setMembersState('error')
    }
  }, [])

  const openChat = useCallback((chat: ChatId | null) => {
    setActive(chat)
    setMessages([])
    setMembers([])
    setMessagesState('idle')
    setMembersState('idle')
    if (chat) socialStore.clearUnread(chatKey(chat))
  }, [])

  useEffect(() => {
    if (!active) return
    void loadMessages(active)
    if (active.kind === 'group') void loadMembers(active.id)
  }, [active, loadMessages, loadMembers])

  // --- live updates -------------------------------------------------------

  useEffect(() =>
    onGroupMessage((msg) => {
      if (active?.kind === 'group' && msg.groupId === active.id) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
        return
      }
      socialStore.incrementUnread(`group:${msg.groupId}`)
    }),
  [active])

  // Direct messages arrive as notifications on the shared store; refresh the
  // open thread when one belongs to it.
  useEffect(() => {
    let seen = socialStore.notifications.length
    return socialStore.subscribe(() => {
      const fresh = socialStore.notifications.slice(0, Math.max(0, socialStore.notifications.length - seen))
      seen = socialStore.notifications.length
      for (const n of fresh) {
        if (n.type === 'message' && typeof n.data?.senderId === 'number') {
          if (active?.kind === 'friend' && n.data.senderId === active.id) void loadMessages(active)
          else socialStore.incrementUnread(`friend:${n.data.senderId}`)
        }
        if (n.type === 'friend_request' || n.type === 'friend_accepted' || n.type === 'group_invite') {
          void loadRoster()
        }
      }
    })
  }, [active, loadMessages, loadRoster])

  // --- mutations ----------------------------------------------------------

  const send = useCallback(
    async (text: string) => {
      if (!active) return
      const body = text.trim().slice(0, 500)
      if (!body) return
      const { message } =
        active.kind === 'group'
          ? await groupsApi.sendMessage(active.id, body)
          : await messagesApi.send(active.id, body)
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
    },
    [active],
  )

  const createGroup = useCallback(async (name: string, memberIds: number[]) => {
    const { group } = await groupsApi.create(name, memberIds)
    setGroups((prev) => [group, ...prev])
    setActive({ kind: 'group', id: group.id })
    return group
  }, [])

  const renameGroup = useCallback(async (groupId: number, name: string) => {
    await groupsApi.rename(groupId, name)
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)))
  }, [])

  const addMembers = useCallback(async (groupId: number, userIds: number[]) => {
    const { members: list } = await groupsApi.addMembers(groupId, userIds)
    setMembers(list)
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, memberCount: list.length } : g)))
  }, [])

  const removeMember = useCallback(async (groupId: number, userId: number) => {
    await groupsApi.removeMember(groupId, userId)
    setMembers((prev) => {
      const next = prev.filter((m) => m.userId !== userId)
      setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, memberCount: next.length } : g)))
      return next
    })
  }, [])

  const leaveGroup = useCallback(async (groupId: number) => {
    await groupsApi.leave(groupId)
    setGroups((prev) => prev.filter((g) => g.id !== groupId))
    setActive((cur) => (cur?.kind === 'group' && cur.id === groupId ? null : cur))
  }, [])

  const requestFriend = useCallback(async (userId: number) => {
    await friendsApi.request(userId)
    await loadRoster()
  }, [loadRoster])

  const respondFriend = useCallback(
    async (friendId: number, action: 'accept' | 'decline') => {
      if (action === 'accept') await friendsApi.accept(friendId)
      else await friendsApi.decline(friendId)
      await loadRoster()
    },
    [loadRoster],
  )

  const removeFriend = useCallback(
    async (friendId: number, otherUserId: number) => {
      await friendsApi.remove(friendId)
      setFriends((prev) => prev.filter((f) => f.id !== friendId))
      setActive((cur) => (cur?.kind === 'friend' && cur.id === otherUserId ? null : cur))
    },
    [],
  )

  const respondGroupInvite = useCallback(
    async (inviteId: number, action: 'accept' | 'decline') => {
      if (action === 'accept') await groupInvitesApi.accept(inviteId)
      else await groupInvitesApi.decline(inviteId)
      await loadRoster()
    },
    [loadRoster],
  )

  /** Incoming requests are the ones the other person sent to us. */
  const incoming = useMemo(
    () => requests.filter((f) => f.userAId !== currentUserId),
    [requests, currentUserId],
  )
  const outgoing = useMemo(
    () => requests.filter((f) => f.userAId === currentUserId),
    [requests, currentUserId],
  )

  return {
    groups,
    friends,
    incoming,
    outgoing,
    invites,
    rosterState,
    reloadRoster: loadRoster,

    active,
    activeGroup,
    activeFriend,
    openChat,
    messages,
    messagesState,
    reloadMessages: () => active && loadMessages(active),
    members,
    membersState,

    send,
    createGroup,
    renameGroup,
    addMembers,
    removeMember,
    leaveGroup,
    requestFriend,
    respondFriend,
    removeFriend,
    respondGroupInvite,
  }
}

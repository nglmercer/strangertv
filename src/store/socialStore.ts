import { useSyncExternalStore } from 'preact/compat'
import type { Friend, Message, PublicUser } from '../../shared/types'

export type Notification = {
  id: string
  type: 'friend_request' | 'friend_accepted' | 'message' | 'invitation' | 'group_message'
  title: string
  body: string
  from?: PublicUser
  timestamp: number
  read: boolean
  data?: Record<string, unknown>
}

type SocialStoreListener = () => void

class SocialStore {
  private listeners = new Set<SocialStoreListener>()
  private _onlineFriends = new Set<number>()
  private _unreadCounts = new Map<string, number>()
  private _notifications: Notification[] = []
  private _lastSeen = new Map<number, number>()

  get onlineFriends(): Set<number> {
    return this._onlineFriends
  }

  get unreadCounts(): Map<string, number> {
    return this._unreadCounts
  }

  get notifications(): Notification[] {
    return this._notifications
  }

  get unreadNotifications(): number {
    return this._notifications.filter((n) => !n.read).length
  }

  subscribe(listener: SocialStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  setOnlineFriends(ids: number[]) {
    this._onlineFriends = new Set(ids)
    this.notify()
  }

  addOnlineFriend(id: number) {
    this._onlineFriends.add(id)
    this.notify()
  }

  removeOnlineFriend(id: number) {
    this._onlineFriends.delete(id)
    this.notify()
  }

  isOnline(userId: number): boolean {
    return this._onlineFriends.has(userId)
  }

  setLastSeen(userId: number, timestamp: number) {
    this._lastSeen.set(userId, timestamp)
    this.notify()
  }

  getLastSeen(userId: number): number | undefined {
    return this._lastSeen.get(userId)
  }

  incrementUnread(key: string) {
    this._unreadCounts.set(key, (this._unreadCounts.get(key) ?? 0) + 1)
    this.notify()
  }

  clearUnread(key: string) {
    this._unreadCounts.delete(key)
    this.notify()
  }

  getUnread(key: string): number {
    return this._unreadCounts.get(key) ?? 0
  }

  addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) {
    const n: Notification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      read: false,
    }
    this._notifications.unshift(n)
    if (this._notifications.length > 50) this._notifications.pop()
    this.notify()
  }

  markNotificationRead(id: string) {
    const n = this._notifications.find((x) => x.id === id)
    if (n) {
      n.read = true
      this.notify()
    }
  }

  markAllNotificationsRead() {
    for (const n of this._notifications) n.read = true
    this.notify()
  }

  clearNotifications() {
    this._notifications = []
    this.notify()
  }

  handleFriendRequest(from: PublicUser) {
    this.addNotification({
      type: 'friend_request',
      title: 'Friend Request',
      body: `${from.email.split('@')[0]} wants to be your friend`,
      from,
    })
  }

  handleFriendAccepted(friend: Friend) {
    this.addNotification({
      type: 'friend_accepted',
      title: 'Request Accepted',
      body: `${friend.otherUser.email.split('@')[0]} accepted your friend request`,
      from: friend.otherUser,
    })
  }

  handleNewMessage(message: Message, sender: PublicUser | undefined, isActiveChat: boolean) {
    if (!isActiveChat && sender) {
      const key = `friend:${message.senderId}`
      this.incrementUnread(key)
      this.addNotification({
        type: 'message',
        title: sender.email.split('@')[0] ?? 'New Message',
        body: message.text.slice(0, 80),
        from: sender,
        data: { senderId: message.senderId },
      })
    }
  }
}

export const socialStore = new SocialStore()

export function useSocialStore(): SocialStore {
  useSyncExternalStore(
    (cb) => socialStore.subscribe(cb),
    () => socialStore,
  )
  return socialStore
}

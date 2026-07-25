import { useState } from 'preact/hooks'
import type { Notification } from '../store/socialStore'
import { socialStore, useSocialStore } from '../store/socialStore'
import type { Messages } from '../i18n'

export function NotificationCenter({ t }: { t: Messages }) {
  const [open, setOpen] = useState(false)
  const notifications = useSocialStore().notifications
  const unread = useSocialStore().unreadNotifications

  const timeAgo = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000)
    if (diff < 60) return `${diff}s`
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    return `${Math.floor(diff / 86400)}d`
  }

  const icon = (type: Notification['type']) => {
    switch (type) {
      case 'friend_request': return '👤'
      case 'friend_accepted': return '✅'
      case 'message': return '💬'
      case 'invitation': return '🎮'
      case 'group_message': return '👥'
    }
  }

  return (
    <div class="notification-center">
      <button
        type="button"
        class="notification-bell"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span class="notification-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div class="notification-dropdown">
          <div class="notification-header">
            <span>{t.notifications}</span>
            {notifications.length > 0 && (
              <button
                type="button"
                class="notification-clear"
                onClick={() => socialStore.markAllNotificationsRead()}
              >
                {t.markAllRead}
              </button>
            )}
          </div>
          <div class="notification-list">
            {notifications.length === 0 ? (
              <p class="notification-empty">{t.noNotifications}</p>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div
                  class={`notification-item ${n.read ? '' : 'unread'}`}
                  key={n.id}
                  onClick={() => socialStore.markNotificationRead(n.id)}
                >
                  <span class="notification-icon">{icon(n.type)}</span>
                  <div class="notification-content">
                    <span class="notification-title">{n.title}</span>
                    <span class="notification-body">{n.body}</span>
                  </div>
                  <span class="notification-time">{timeAgo(n.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function NotificationToast({ t }: { t: Messages }) {
  const [visible, setVisible] = useState(false)
  const [current, setCurrent] = useState<Notification | null>(null)

  if (!visible || !current) return null

  return (
    <div class="notification-toast" role="alert" onClick={() => setVisible(false)}>
      <span class="notification-toast-icon">
        {current.type === 'friend_request' && '👤'}
        {current.type === 'friend_accepted' && '✅'}
        {current.type === 'message' && '💬'}
        {current.type === 'invitation' && '🎮'}
        {current.type === 'group_message' && '👥'}
      </span>
      <div class="notification-toast-content">
        <span class="notification-toast-title">{current.title}</span>
        <span class="notification-toast-body">{current.body}</span>
      </div>
      <button
        type="button"
        class="notification-toast-close"
        onClick={(e) => { e.stopPropagation(); setVisible(false) }}
        aria-label={t.close}
      >
        ×
      </button>
    </div>
  )
}

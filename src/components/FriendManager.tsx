import { useEffect, useState } from 'preact/hooks'
import type { Friend } from '../../shared/types'
import { friendsApi, type PublicUser } from '../api'
import { Modal } from './Modal'
import type { Messages } from '../i18n'

type Tab = 'friends' | 'requests' | 'search'

export function FriendManager({ t, user, onClose }: { t: Messages; user: PublicUser | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('friends')
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<Friend[]>([])
  const [searchEmail, setSearchEmail] = useState('')
  const [searchResult, setSearchResult] = useState<PublicUser | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const loadFriends = async () => {
    try {
      const { friends: list } = await friendsApi.list()
      setFriends(list.filter((f) => f.status === 'accepted'))
      setRequests(list.filter((f) => f.status === 'pending'))
    } catch {
      setError(t.genericError)
    }
  }

  useEffect(() => {
    if (user) void loadFriends()
  }, [user])

  const handleSearch = async () => {
    if (!searchEmail.trim()) return
    setLoading(true)
    setError('')
    setSearchResult(null)
    try {
      const { user } = await friendsApi.search(searchEmail.trim())
      if (user) {
        setSearchResult(user)
      } else {
        setError(t.searchFailed)
      }
    } catch {
      setError(t.genericError)
    } finally {
      setLoading(false)
    }
  }

  const handleRequest = async (userId: number) => {
    try {
      await friendsApi.request(userId)
      setSearchResult(null)
      setSearchEmail('')
      await loadFriends()
    } catch {
      setError(t.genericError)
    }
  }

  const handleAccept = async (friendId: number) => {
    try {
      await friendsApi.accept(friendId)
      await loadFriends()
    } catch {
      setError(t.genericError)
    }
  }

  const handleDecline = async (friendId: number) => {
    try {
      await friendsApi.decline(friendId)
      await loadFriends()
    } catch {
      setError(t.genericError)
    }
  }

  const handleRemove = async (friendId: number) => {
    try {
      await friendsApi.remove(friendId)
      await loadFriends()
    } catch {
      setError(t.genericError)
    }
  }

  if (!user) {
    return (
      <Modal onClose={onClose} className="modal friend-modal">
        <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
        <h2>{t.friends}</h2>
        <p class="modal-copy">{t.signInToBlock}</p>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} className="modal friend-modal">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2>{t.friends}</h2>

      <div class="friend-tabs">
        <button
          type="button"
          class={`friend-tab ${tab === 'friends' ? 'on' : ''}`}
          onClick={() => setTab('friends')}
        >
          {t.friends}
          <span class="friend-badge">{friends.length}</span>
        </button>
        <button
          type="button"
          class={`friend-tab ${tab === 'requests' ? 'on' : ''}`}
          onClick={() => setTab('requests')}
        >
          {t.friendRequests}
          {requests.length > 0 && <span class="friend-badge">{requests.length}</span>}
        </button>
        <button
          type="button"
          class={`friend-tab ${tab === 'search' ? 'on' : ''}`}
          onClick={() => setTab('search')}
        >
          {t.searchFriends}
        </button>
      </div>

      {error && <p class="form-error">{error}</p>}

      {tab === 'friends' && (
        <div class="friend-list">
          {friends.length === 0 ? (
            <p class="friend-empty">{t.noFriends}</p>
          ) : (
            friends.map((f) => (
              <div class="friend-item" key={f.id}>
                <div class="friend-info">
                  <span class="friend-email">{f.otherUser.email}</span>
                  {f.otherUser.country && (
                    <span class="friend-country">{f.otherUser.country}</span>
                  )}
                </div>
                <div class="friend-actions">
                  <button
                    type="button"
                    class="friend-btn invite"
                    onClick={() => handleRequest(f.otherUser.id)}
                  >
                    {t.inviteToMatch}
                  </button>
                  <button
                    type="button"
                    class="friend-btn danger"
                    onClick={() => handleRemove(f.id)}
                  >
                    {t.unfriend}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div class="friend-list">
          {requests.length === 0 ? (
            <p class="friend-empty">{t.noRequests}</p>
          ) : (
            requests.map((f) => (
              <div class="friend-item" key={f.id}>
                <div class="friend-info">
                  <span class="friend-email">{f.otherUser.email}</span>
                </div>
                <div class="friend-actions">
                  <button
                    type="button"
                    class="friend-btn accept"
                    onClick={() => handleAccept(f.id)}
                  >
                    {t.accept}
                  </button>
                  <button
                    type="button"
                    class="friend-btn danger"
                    onClick={() => handleDecline(f.id)}
                  >
                    {t.decline}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'search' && (
        <div class="friend-search">
          <div class="friend-search-row">
            <input
              type="email"
              placeholder={t.searchFriends}
              value={searchEmail}
              onInput={(e) => setSearchEmail((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch()
              }}
            />
            <button
              type="button"
              class="friend-btn accept"
              onClick={() => void handleSearch()}
              disabled={loading}
            >
              {t.search}
            </button>
          </div>
          {searchResult && (
            <div class="friend-item">
              <div class="friend-info">
                <span class="friend-email">{searchResult.email}</span>
                {searchResult.country && (
                  <span class="friend-country">{searchResult.country}</span>
                )}
              </div>
              <div class="friend-actions">
                <button
                  type="button"
                  class="friend-btn accept"
                  onClick={() => void handleRequest(searchResult.id)}
                >
                  {t.sendRequest}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

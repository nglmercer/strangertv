import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import type { Follow } from '../../../shared/types'
import { followsApi } from '../../api'
import { initials } from '../../pages/profileMock'
import { Icon, icons } from '../icons'
import { Modal } from '../Modal'

export type FollowTab = 'followers' | 'following'

function rowName(u: Follow['followedUser']): string {
  return u.displayName || u.username || 'Someone'
}

/**
 * Followers/following lists for a profile page. Opens on the tapped stat
 * and lets the viewer flip tabs without refetching; each row links to that
 * user's public profile.
 */
export function FollowListsModal({
  userId,
  tab,
  onClose,
}: {
  userId: number
  tab: FollowTab
  onClose: () => void
}) {
  const [active, setActive] = useState<FollowTab>(tab)
  const [lists, setLists] = useState<{ followers: Follow[]; following: Follow[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    followsApi.listFor(userId).then(
      (dto) => {
        if (live) setLists({ followers: dto.followers, following: dto.following })
      },
      () => {
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [userId])

  const rows = active === 'followers' ? lists?.followers : lists?.following

  const openProfile = (username?: string) => {
    if (!username) return
    onClose()
    route(`/u/${username}`)
  }

  return (
    <Modal onClose={onClose} labelledBy="pfollows-title">
      <div class="pmodal-header">
        <h2 id="pfollows-title">Connections</h2>
        <button type="button" class="pmodal-close" onClick={onClose} aria-label="Close dialog">
          <Icon d={icons.close} size={18} />
        </button>
      </div>
      <div class="pfollows-tabs" role="tablist" aria-label="Followers or following">
        {(['followers', 'following'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            class={active === key ? 'pfollows-tab is-active' : 'pfollows-tab'}
            onClick={() => setActive(key)}
          >
            {key === 'followers' ? 'Followers' : 'Following'}
          </button>
        ))}
      </div>
      <div class="pfollows-list">
        {failed && <p class="pedit-muted">Couldn't load this list.</p>}
        {!failed && !rows && <p class="pedit-muted">Loading…</p>}
        {!failed && rows?.length === 0 && (
          <p class="pedit-muted">
            {active === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
          </p>
        )}
        {rows?.map((entry) => {
          const user = entry.followedUser
          const name = rowName(user)
          return (
            <button
              key={entry.id}
              type="button"
              class="pfollows-row"
              disabled={!user.username}
              onClick={() => openProfile(user.username)}
            >
              <span class="pfollows-avatar" aria-hidden="true">
                {initials(name)}
              </span>
              <span class="pfollows-id">
                <strong>{name}</strong>
                {user.username && <span>@{user.username}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

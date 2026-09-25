import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { route } from 'preact-router'
import type { PublicUser } from '../../shared/types'
import { followsApi, getStoredUser } from '../api'
import { Icon, icons } from '../components/icons'

/**
 * Viewer-relative follow relationship. Mirrors the app's shared
 * RelationshipStatus: none=stranger, following, follower, friend=mutual.
 */
export type FollowStatus = 'stranger' | 'following' | 'follower' | 'mutual'

/** Pure relationship derivation shared by the hook and its tests. */
export function statusFromState(iFollow: boolean, theyFollow: boolean): FollowStatus {
  if (iFollow && theyFollow) return 'mutual'
  if (iFollow) return 'following'
  if (theyFollow) return 'follower'
  return 'stranger'
}

export type FollowState = {
  iFollow: boolean
  theyFollow: boolean
  status: FollowStatus
  mutuals: PublicUser[]
  /** Follower-count adjustment vs the server count (optimistic toggle). */
  countDelta: number
  pending: boolean
  toggleIFollow: () => void
  refresh: () => void
}

/**
 * Real viewer-relative follow state for a profile page. Logged-out viewers
 * read as strangers; toggling logged-out calls `onRequireAuth` (the page
 * opens the sign-in modal) instead of hitting the API. Toggles are
 * optimistic and roll back on failure.
 */
export function useFollow(targetId: number | null, onRequireAuth?: () => void): FollowState {
  const [iFollow, setIFollow] = useState(false)
  const [theyFollow, setTheyFollow] = useState(false)
  const [mutuals, setMutuals] = useState<PublicUser[]>([])
  // Snapshot of the server edge when the header count loaded. Toggles move
  // `iFollow` only, so the delta stays measured against the stale header;
  // loads (and refresh, which runs pre-toggle after login) resync both.
  const [baseIFollow, setBaseIFollow] = useState(false)
  const [pending, setPending] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const authCb = useRef(onRequireAuth)
  authCb.current = onRequireAuth

  useEffect(() => {
    setIFollow(false)
    setTheyFollow(false)
    setMutuals([])
    setBaseIFollow(false)
    if (targetId == null || getStoredUser() == null) return
    let live = true
    followsApi.state(targetId).then(
      (st) => {
        if (!live) return
        setIFollow(st.following)
        setBaseIFollow(st.following)
        setTheyFollow(st.followsYou)
        setMutuals(st.mutuals)
      },
      () => {
        /* expired session or offline: stay a stranger */
      },
    )
    return () => {
      live = false
    }
  }, [targetId, refreshKey])

  const toggleIFollow = useCallback(() => {
    if (targetId == null || pending) return
    if (getStoredUser() == null) {
      authCb.current?.()
      return
    }
    const next = !iFollow
    setPending(true)
    setIFollow(next)
    ;(next ? followsApi.follow(targetId) : followsApi.unfollow(targetId)).then(
      () => {
        setPending(false)
      },
      () => {
        setIFollow(!next)
        setPending(false)
      },
    )
  }, [targetId, pending, iFollow])

  return {
    iFollow,
    theyFollow,
    status: statusFromState(iFollow, theyFollow),
    mutuals,
    countDelta: iFollow === baseIFollow ? 0 : iFollow ? 1 : -1,
    pending,
    toggleIFollow,
    refresh: () => setRefreshKey((k) => k + 1),
  }
}

export function followLabel(status: FollowStatus): string {
  switch (status) {
    case 'mutual':
      return 'Friends'
    case 'following':
      return 'Following'
    case 'follower':
      return 'Follow back'
    default:
      return 'Follow'
  }
}

/**
 * Shared follow/message actions. The Message button only appears on mutual
 * follow and opens the social surface where conversations live.
 */
export function ProfileActions({ follow, dark }: { follow: FollowState; dark?: boolean }) {
  const { status } = follow
  const mutual = status === 'mutual'
  const following = status === 'following' || mutual

  return (
    <div class={dark ? 'pact pact-dark' : 'pact'}>
      <div class="pact-row">
        <button
          type="button"
          class={following ? 'pact-follow is-following' : 'pact-follow'}
          onClick={follow.toggleIFollow}
        >
          {mutual && <Icon d={icons.check} size={15} className="pact-check" />}
          <span class="pact-label">{followLabel(status)}</span>
          <span class="pact-label-hover">Unfollow</span>
        </button>
        {mutual && (
          <button type="button" class="pact-msg" onClick={() => route('/social')}>
            <Icon d={icons.chatBubble} size={16} />
            <span>Message</span>
          </button>
        )}
      </div>
    </div>
  )
}

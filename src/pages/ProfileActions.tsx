import { useState } from 'preact/hooks'
import { Icon, icons } from '../components/icons'

/**
 * Design-demo follow relationship (viewer perspective). Mirrors the app's
 * shared RelationshipStatus: none=stranger, following, follower, friend=mutual.
 */
export type FollowStatus = 'stranger' | 'following' | 'follower' | 'mutual'

export type FollowState = {
  iFollow: boolean
  theyFollow: boolean
  status: FollowStatus
  toggleIFollow: () => void
  toggleTheyFollow: () => void
}

export function useFollow(): FollowState {
  const [iFollow, setIFollow] = useState(false)
  // Placeholder until the server provides the reverse edge.
  const [theyFollow, setTheyFollow] = useState(false)
  const status: FollowStatus =
    iFollow && theyFollow
      ? 'mutual'
      : iFollow
        ? 'following'
        : theyFollow
          ? 'follower'
          : 'stranger'
  return {
    iFollow,
    theyFollow,
    status,
    toggleIFollow: () => setIFollow((v) => !v),
    toggleTheyFollow: () => setTheyFollow((v) => !v),
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
 * Shared follow/message actions for all profile drafts. The Message button
 * only appears on mutual follow.
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
          <button type="button" class="pact-msg" title="Send message (design mock)">
            <Icon d={icons.chatBubble} size={16} />
            <span>Message</span>
          </button>
        )}
      </div>
    </div>
  )
}

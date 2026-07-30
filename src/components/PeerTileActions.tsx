import type { Messages } from '../i18n'
import type { PublicUser } from '../api'
import { Icon, icons } from './icons'

export type TilePeer = {
  peerId: number
  userId: number
  email?: string
}

/**
 * Per-participant quick actions rendered on top of a group video tile.
 *
 * Desktop: revealed on tile hover / keyboard focus (pure CSS in stage.css).
 * Touch: the parent tile long-presses to pin the menu open (`open`), since
 * hover does not exist on mobile.
 *
 * `onPointerDown`/`onClick` stop-propagation so taps here never trigger the
 * tile's own long-press/pin handling underneath.
 */
export function PeerTileActions({
  peer,
  t,
  user,
  muted,
  open,
  onClose,
  onAddFriend,
  onFollow,
  onInviteGroup,
  onToggleMute,
}: {
  peer: TilePeer
  t: Messages
  user: PublicUser | null
  muted: boolean
  open: boolean
  onClose: () => void
  onAddFriend: (userId: number) => void
  onFollow: (userId: number) => void
  onInviteGroup: (userId: number) => void
  onToggleMute: (peerId: number, muted: boolean) => void
}) {
  // Social actions need a signed-in viewer and a signed-in peer who isn't us.
  const signedPeer = Boolean(user && peer.userId && peer.userId !== user.id)

  const act = (fn: () => void) => (e: Event) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      class={`tile-actions ${open ? 'open' : ''}`}
      role="toolbar"
      aria-label={t.participants}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {signedPeer && (
        <button
          type="button"
          class="tile-action"
          title={t.addFriend}
          aria-label={t.addFriend}
          onClick={act(() => {
            onAddFriend(peer.userId)
            onClose()
          })}
        >
          <Icon d={icons.userPlus} size={16} />
        </button>
      )}
      {signedPeer && (
        <button
          type="button"
          class="tile-action"
          title={t.follow}
          aria-label={t.follow}
          onClick={act(() => {
            onFollow(peer.userId)
            onClose()
          })}
        >
          <Icon d={icons.follow} size={16} />
        </button>
      )}
      {signedPeer && (
        <button
          type="button"
          class="tile-action"
          title={t.inviteToGroupMatch}
          aria-label={t.inviteToGroupMatch}
          onClick={act(() => {
            onInviteGroup(peer.userId)
            onClose()
          })}
        >
          <Icon d={icons.users} size={16} />
        </button>
      )}
      <button
        type="button"
        class={`tile-action ${muted ? 'is-muted' : ''}`}
        title={muted ? t.unmute : t.mute}
        aria-label={muted ? t.unmute : t.mute}
        aria-pressed={muted}
        onClick={act(() => onToggleMute(peer.peerId, !muted))}
      >
        <Icon d={muted ? icons.micOff : icons.micOn} size={16} />
      </button>
    </div>
  )
}

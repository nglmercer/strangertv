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
  solo = false,
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
  /** 1:1 tile: the peer is unambiguous, so it can be invited even as a guest. */
  solo?: boolean
}) {
  // Social actions need a signed-in viewer and a signed-in peer who isn't us.
  // When that is not the case the buttons stay visible but disabled: a lone
  // mute icon gives no hint that a tile carries per-participant actions.
  const signedPeer = Boolean(user && peer.userId && peer.userId !== user.id)
  // A group invite is routed by userId, so a guest tile in a group match cannot
  // be singled out — in a 1:1 call the server resolves it from the partner.
  const canInvite = Boolean(user) && (signedPeer || solo)
  const socialHint = user ? t.peerNotSignedIn : t.signIn

  const act = (fn: () => void) => (e: Event) => {
    e.stopPropagation()
    fn()
  }

  const socialAction = (label: string, iconPath: string, enabled: boolean, run: () => void) => (
    <button
      type="button"
      class="tile-action"
      disabled={!enabled}
      title={enabled ? label : socialHint}
      aria-label={label}
      onClick={act(() => {
        run()
        onClose()
      })}
    >
      <Icon d={iconPath} size={16} />
    </button>
  )

  return (
    <div
      class={`tile-actions ${open ? 'open' : ''}`}
      role="toolbar"
      aria-label={t.participants}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {socialAction(t.addFriend, icons.userPlus, signedPeer, () => onAddFriend(peer.userId))}
      {socialAction(t.follow, icons.follow, signedPeer, () => onFollow(peer.userId))}
      {socialAction(t.inviteToGroupMatch, icons.users, canInvite, () => onInviteGroup(peer.userId))}
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

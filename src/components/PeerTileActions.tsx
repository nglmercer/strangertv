import type { ComponentChildren } from 'preact'
import type { Messages } from '../i18n'
import type { PublicUser } from '../api'
import { Icon, icons } from './icons'

export type TilePeer = {
  peerId: number
  userId: number
  email?: string
}

/**
 * Per-participant actions for a video tile, built on the same call-bar shell as
 * the local tile's CallBar so both tiles read as one control system: a pill
 * pinned to the bottom of the tile holding the frequent action (mute) inline,
 * with the rest behind a "more" menu. Only the items differ.
 *
 * Long-pressing the tile opens the same menu, for touch.
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
  onReport,
  onBlock,
  onToggle,
  status,
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
  onReport: (userId: number) => void
  onBlock: (userId: number) => void
  /** Opens/closes the "more" menu from its toggle button. */
  onToggle: () => void
  /** Status (connection quality) pinned to the end of the row. */
  status?: ComponentChildren
  /** 1:1 tile: the peer is unambiguous, so it can be invited even as a guest. */
  solo?: boolean
}) {
  // Social actions need a signed-in viewer and a signed-in peer who isn't us.
  // When that is not the case the items stay visible but disabled: an empty
  // menu gives no hint that a tile carries per-participant actions.
  const signedPeer = Boolean(user && peer.userId && peer.userId !== user.id)
  // A group invite is routed by userId, so a guest tile in a group match cannot
  // be singled out — in a 1:1 call the server resolves it from the partner.
  const canInvite = Boolean(user) && (signedPeer || solo)
  const socialHint = user ? t.peerNotSignedIn : t.signIn

  const act = (fn: () => void) => (e: Event) => {
    e.stopPropagation()
    fn()
  }

  const item = (
    label: string,
    iconPath: string,
    enabled: boolean,
    run: () => void,
    extraClass = '',
    disabledHint = socialHint,
  ) => (
    <button
      type="button"
      role="menuitem"
      class={`call-menu-item ${extraClass}`.trim()}
      disabled={!enabled}
      title={enabled ? label : disabledHint}
      onClick={act(() => {
        run()
        onClose()
      })}
    >
      <Icon d={iconPath} size={18} />
      <span>{enabled ? label : disabledHint}</span>
    </button>
  )

  return (
    <div
      class="call-bar tile-bar"
      role="toolbar"
      aria-label={t.participants}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Mute is the one action worth a permanent button: it is the only one
          you reach for mid-sentence. */}
      <button
        type="button"
        class={`call-btn icon ${muted ? 'is-off' : ''}`}
        aria-label={muted ? t.unmute : t.mute}
        aria-pressed={muted}
        title={muted ? t.unmute : t.mute}
        onClick={act(() => onToggleMute(peer.peerId, !muted))}
      >
        <Icon d={muted ? icons.micOff : icons.micOn} />
      </button>

      <div class={`call-more ${open ? 'open' : ''}`}>
        <button
          type="button"
          class={`call-btn icon ${open ? 'is-active' : ''}`}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t.moreActions}
          title={t.moreActions}
          onClick={act(onToggle)}
        >
          <Icon d={icons.more} />
        </button>
        {open && (
          <div class="call-more-menu" role="menu">
            {item(t.addFriend, icons.userPlus, signedPeer, () => onAddFriend(peer.userId))}
            {item(t.follow, icons.follow, signedPeer, () => onFollow(peer.userId))}
            {item(t.inviteToGroupMatch, icons.users, canInvite, () => onInviteGroup(peer.userId))}
            <div class="call-menu-sep" />
            {/* Safety actions live next to the participant they act on: in a
                group match there is no other way to say WHO is being
                reported/blocked. */}
            {item(t.report, icons.report, true, () => onReport(peer.userId))}
            {item(
              t.blockPeer,
              icons.block,
              signedPeer,
              () => onBlock(peer.userId),
              'danger',
              user ? t.peerNotSignedIn : t.signInToBlock,
            )}
          </div>
        )}
      </div>
      {status}
    </div>
  )
}

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
 * Per-participant actions for a video tile, as a panel that is collapsed by
 * default: only a small toggle sits on the video, and opening it reveals the
 * actions plus the connection status. Long-pressing the tile toggles it too,
 * for touch. Each button carries a `data-tip` tooltip (styled in stage.css).
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
  /** Opens/closes the panel from its toggle button. */
  onToggle: () => void
  /** Status (connection quality) pinned to the end of the row. */
  status?: ComponentChildren
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

  const action = (
    label: string,
    iconPath: string,
    enabled: boolean,
    run: () => void,
    extraClass = '',
    disabledHint = socialHint,
  ) => (
    <button
      type="button"
      class={`tile-action ${extraClass}`.trim()}
      disabled={!enabled}
      data-tip={enabled ? label : disabledHint}
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
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Collapsed by default: only this toggle sits on the video. Everything
          else — including the connection status — lives in the panel below. */}
      <button
        type="button"
        class="tile-actions-toggle"
        aria-expanded={open}
        aria-label={t.moreActions}
        data-tip={t.moreActions}
        onClick={act(onToggle)}
      >
        <Icon d={open ? icons.chevron : icons.more} size={16} />
      </button>
      <div class="tile-actions-panel" role="toolbar" aria-label={t.participants} aria-hidden={!open}>
        {action(t.addFriend, icons.userPlus, signedPeer, () => onAddFriend(peer.userId))}
        {action(t.follow, icons.follow, signedPeer, () => onFollow(peer.userId))}
        {action(t.inviteToGroupMatch, icons.users, canInvite, () => onInviteGroup(peer.userId))}
        <button
          type="button"
          class={`tile-action ${muted ? 'is-muted' : ''}`}
          data-tip={muted ? t.unmute : t.mute}
          aria-label={muted ? t.unmute : t.mute}
          aria-pressed={muted}
          onClick={act(() => onToggleMute(peer.peerId, !muted))}
        >
          <Icon d={muted ? icons.micOff : icons.micOn} size={16} />
        </button>
        {/* Safety actions live next to the participant they act on: in a group
            match there is no other way to say WHO is being reported/blocked. */}
        {action(t.report, icons.report, true, () => onReport(peer.userId))}
        {action(
          t.blockPeer,
          icons.block,
          signedPeer,
          () => onBlock(peer.userId),
          'danger',
          user ? t.peerNotSignedIn : t.signInToBlock,
        )}
        {status}
      </div>
    </div>
  )
}

import type { ComponentChild } from 'preact'
import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

/**
 * The one person row used across People, group members, and search results:
 * avatar, name + sub-line, optional tags inside the name, and an action slot.
 * Pass `onOpen` to make the text block open the chat.
 */
export function PersonRow({
  avatar,
  name,
  sub,
  actions,
  muted,
  onOpen,
}: {
  avatar: ComponentChild
  name: ComponentChild
  sub?: ComponentChild
  actions?: ComponentChild
  muted?: boolean
  onOpen?: () => void
}) {
  const text = (
    <>
      <span class="people-row-name">{name}</span>
      {sub != null && sub !== '' && <span class="people-row-sub">{sub}</span>}
    </>
  )
  return (
    <div class={muted ? 'people-row is-muted' : 'people-row'}>
      {avatar}
      {onOpen ? (
        <button type="button" class="people-row-text as-button" onClick={onOpen}>
          {text}
        </button>
      ) : (
        <span class="people-row-text">{text}</span>
      )}
      {actions}
    </div>
  )
}

/** Paired accept/decline icon buttons for requests and invites. */
export function AcceptDecline({
  t,
  busy,
  onAccept,
  onDecline,
}: {
  t: Messages
  busy?: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <span class="people-row-actions">
      <button
        type="button"
        class="icon-btn ok"
        title={t.accept}
        aria-label={t.accept}
        disabled={busy}
        onClick={onAccept}
      >
        <Icon d={icons.check} size={16} />
      </button>
      <button
        type="button"
        class="icon-btn danger"
        title={t.decline}
        aria-label={t.decline}
        disabled={busy}
        onClick={onDecline}
      >
        <Icon d={icons.close} size={16} />
      </button>
    </span>
  )
}

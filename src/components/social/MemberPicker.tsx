import type { ComponentChild } from 'preact'
import type { Friend } from '../../../shared/types'
import { Icon, icons } from '../icons'
import { Avatar } from './Avatar'
import { userDisplayName } from './people'

/**
 * Friend toggle list shared by group creation and adding members: full-width
 * rows with avatar, name, and check state. `picked` holds user ids.
 */
export function MemberPicker({
  friends,
  picked,
  empty,
  onToggle,
}: {
  friends: Friend[]
  picked: ReadonlySet<number>
  empty?: ComponentChild
  onToggle: (userId: number) => void
}) {
  if (friends.length === 0) return <>{empty}</>
  return (
    <div class="pick-list">
      {friends.map((f) => {
        const on = picked.has(f.otherUser.id)
        const name = userDisplayName(f.otherUser)
        return (
          <button
            type="button"
            key={f.id}
            class={`pick-row ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(f.otherUser.id)}
          >
            <Avatar name={name} size={30} />
            <span class="pick-name">{name}</span>
            <span class="pick-check">{on && <Icon d={icons.check} size={15} />}</span>
          </button>
        )
      })}
    </div>
  )
}

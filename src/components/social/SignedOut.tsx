import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

const POINTS = [
  { icon: icons.userPlus, title: (t: Messages) => t.friends, desc: (t: Messages) => t.socialPointFriends },
  { icon: icons.chatBubble, title: (t: Messages) => t.chats, desc: (t: Messages) => t.groupChatDesc },
  { icon: icons.users, title: (t: Messages) => t.groupMatch, desc: (t: Messages) => t.groupMatchDesc },
] as const

/**
 * Signed-out state: one line of purpose, three short capability lines, one
 * action. The previous screen was a marketing page with its own headings and
 * card grid that dwarfed the sign-in button.
 */
export function SignedOut({ t, onSignIn }: { t: Messages; onSignIn?: () => void }) {
  return (
    <div class="social-signed-out">
      <div class="signed-out-card">
        <span class="signed-out-icon" aria-hidden="true">
          <Icon d={icons.users} size={28} />
        </span>
        <h2>{t.social}</h2>
        <p class="signed-out-lead">{t.signInToSocial}</p>

        <ul class="signed-out-points">
          {POINTS.map((point) => (
            <li key={point.title(t)}>
              <span class="signed-out-point-icon" aria-hidden="true">
                <Icon d={point.icon} size={16} />
              </span>
              <span>
                <strong>{point.title(t)}</strong>
                <small>{point.desc(t)}</small>
              </span>
            </li>
          ))}
        </ul>

        <button type="button" class="match full" onClick={onSignIn}>
          {t.signIn}
        </button>
      </div>
    </div>
  )
}

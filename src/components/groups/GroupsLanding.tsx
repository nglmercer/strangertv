import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

const FEATURES = [
  {
    key: 'create',
    icon: icons.users,
    title: (t: Messages) => t.createGroups,
    desc: (t: Messages) => t.createGroupsDesc,
  },
  {
    key: 'chat',
    icon: icons.chatBubble,
    title: (t: Messages) => t.groupChat,
    desc: (t: Messages) => t.groupChatDesc,
  },
  {
    key: 'play',
    icon: icons.game,
    title: (t: Messages) => t.joinActivities,
    desc: (t: Messages) => t.joinActivitiesDesc,
  },
] as const

export function GroupsLanding({ t, onSignIn }: { t: Messages; onSignIn?: () => void }) {
  return (
    <div class="groups-landing">
      <div class="groups-landing-content">
        <h2 class="groups-landing-title">{t.groupsWithFriends}</h2>
        <p class="groups-landing-desc">{t.groupsWithFriendsDesc}</p>

        <div class="groups-landing-features">
          {FEATURES.map((feature) => (
            <article key={feature.key} class="group-feature-card">
              <span class="feature-icon" aria-hidden="true">
                <Icon d={feature.icon} size={20} />
              </span>
              <h3>{feature.title(t)}</h3>
              <p>{feature.desc(t)}</p>
            </article>
          ))}
        </div>

        <button type="button" class="groups-landing-cta" onClick={onSignIn}>
          {t.signInToJoin}
        </button>
      </div>
    </div>
  )
}

import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

const FEATURES = [
  {
    key: 'create',
    icon: icons.users,
    title: (t: Messages) => t.createGroups,
    desc: (t: Messages) => t.createGroupsDesc,
    tone: 'accent',
  },
  {
    key: 'chat',
    icon: icons.chatBubble,
    title: (t: Messages) => t.groupChat,
    desc: (t: Messages) => t.groupChatDesc,
    tone: 'green',
  },
  {
    key: 'play',
    icon: icons.game,
    title: (t: Messages) => t.joinActivities,
    desc: (t: Messages) => t.joinActivitiesDesc,
    tone: 'info',
  },
] as const

export function GroupsLanding({ t, onSignIn }: { t: Messages; onSignIn?: () => void }) {
  return (
    <div class="groups-landing">
      <div class="groups-landing-glow" aria-hidden="true" />

      <div class="groups-landing-content">
        <div class="groups-landing-badge">
          <Icon d={icons.users} size={14} />
          <span>{t.social}</span>
        </div>

        <h2 class="groups-landing-title">{t.groupsWithFriends}</h2>
        <p class="groups-landing-desc">{t.groupsWithFriendsDesc}</p>

        <div class="groups-landing-features">
          {FEATURES.map((feature) => (
            <article key={feature.key} class={`group-feature-card tone-${feature.tone}`}>
              <span class="feature-icon" aria-hidden="true">
                <Icon d={feature.icon} size={22} />
              </span>
              <h3>{feature.title(t)}</h3>
              <p>{feature.desc(t)}</p>
            </article>
          ))}
        </div>

        <div class="groups-landing-actions">
          <button type="button" class="groups-landing-cta" onClick={onSignIn}>
            <Icon d={icons.arrowRight} size={18} />
            <span>{t.signInToJoin}</span>
          </button>
          <p class="groups-landing-hint">{t.readySub}</p>
        </div>
      </div>
    </div>
  )
}

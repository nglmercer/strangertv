import type { Messages } from '../../i18n'
import { Icon, icons } from '../icons'

export function GroupsLanding({ t, onSignIn }: { t: Messages; onSignIn?: () => void }) {
  return (
    <div class="groups-landing">
      <h3>{t.groupsWithFriends}</h3>
      <p>{t.groupsWithFriendsDesc}</p>

      <div class="groups-landing-features">
        <div class="group-feature-card">
          <span class="feature-icon"><Icon d={icons.users} size={28} /></span>
          <h4>{t.createGroups}</h4>
          <p>{t.createGroupsDesc}</p>
        </div>
        <div class="group-feature-card">
          <span class="feature-icon"><Icon d={icons.chatBubble} size={28} /></span>
          <h4>{t.groupChat}</h4>
          <p>{t.groupChatDesc}</p>
        </div>
        <div class="group-feature-card">
          <span class="feature-icon"><Icon d={icons.game} size={28} /></span>
          <h4>{t.joinActivities}</h4>
          <p>{t.joinActivitiesDesc}</p>
        </div>
      </div>

      <button type="button" class="groups-landing-cta" onClick={onSignIn}>
        <Icon d={icons.arrowRight} size={18} />
        {t.signInToJoin}
      </button>
    </div>
  )
}
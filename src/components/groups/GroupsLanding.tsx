import type { Messages } from '../../i18n'

export function GroupsLanding({ t, onSignIn }: { t: Messages; onSignIn?: () => void }) {
  return (
    <div class="groups-landing">
      <h3>{t.groupsWithFriends}</h3>
      <p>{t.groupsWithFriendsDesc}</p>

      <div class="groups-landing-features">
        <div class="group-feature-card">
          <span class="feature-icon">👥</span>
          <h4>{t.createGroups}</h4>
          <p>{t.createGroupsDesc}</p>
        </div>
        <div class="group-feature-card">
          <span class="feature-icon">💬</span>
          <h4>{t.groupChat}</h4>
          <p>{t.groupChatDesc}</p>
        </div>
        <div class="group-feature-card">
          <span class="feature-icon">🎮</span>
          <h4>{t.joinActivities}</h4>
          <p>{t.joinActivitiesDesc}</p>
        </div>
      </div>

      <button type="button" class="groups-landing-cta" onClick={onSignIn}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
        </svg>
        {t.signInToJoin}
      </button>
    </div>
  )
}
import type { PublicUser } from '../api'
import type { Messages } from '../i18n'

interface GroupsSectionProps {
  t: Messages
  user: PublicUser | null
}

export function GroupsSection({ t, user }: GroupsSectionProps) {
  if (!user) {
    return (
      <section class="groups-section">
        <div class="groups-header">
          <div class="groups-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <h2>{t.friendGroups}</h2>
          </div>
        </div>

        <div class="groups-landing">
          <h3>{t.groupsWithFriends}</h3>
          <p>{t.groupsWithFriendsDesc}</p>

          <button type="button" class="groups-landing-cta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
            </svg>
            {t.signInToJoin}
          </button>
        </div>
        <div class="footer"></div>
      </section>
    )
  }


  return (
    <section class="groups-section">

    </section>
  )
}

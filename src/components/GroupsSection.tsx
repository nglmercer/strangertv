import type { PublicUser } from '../api'
import type { Messages } from '../i18n'
import { GroupsLanding } from './groups/GroupsLanding'
import { GroupsApp } from './groups/GroupsApp'

interface GroupsSectionProps {
  t: Messages
  user: PublicUser | null
  onSignIn?: () => void
}

export function GroupsSection({ t, user, onSignIn }: GroupsSectionProps) {
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

      {user ? (
        <GroupsApp t={t} currentUserId={user.id} />
      ) : (
        <GroupsLanding t={t} onSignIn={onSignIn} />
      )}

      <div class="footer"></div>
    </section>
  )
}
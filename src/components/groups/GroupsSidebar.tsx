import type { Group } from '../../../shared/types'
import type { Messages } from '../../i18n'

export function GroupsSidebar({
  t,
  groups,
  activeGroupId,
  onSelectGroup,
  onCreateGroup,
}: {
  t: Messages
  groups: Group[]
  activeGroupId: number | null
  onSelectGroup: (id: number) => void
  onCreateGroup: () => void
}) {
  return (
    <div class="groups-sidebar">
      <div class="groups-sidebar-header">
        <span>{t.yourGroups}</span>
        <button type="button" class="groups-sidebar-new" onClick={onCreateGroup} aria-label={t.newGroup}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div class="groups-list">
        {groups.length === 0 ? (
          <p class="groups-empty">{t.noGroups}</p>
        ) : (
          groups.map((group) => (
            <button
              type="button"
              class={`group-item ${activeGroupId === group.id ? 'active' : ''}`}
              key={group.id}
              onClick={() => onSelectGroup(group.id)}
            >
              <div class="group-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div class="group-info">
                <span class="group-name">{group.name}</span>
                <span class="group-members">
                  {group.memberCount} {t.members}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
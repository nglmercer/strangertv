import type { ActivityEntry, ActivityInstance } from '../../../shared/types'
import type { Messages } from '../../i18n'
import type { LoadState } from '../../hooks/useSocialData'
import { Modal } from '../Modal'
import { Icon, icons } from '../icons'
import { ErrorState, ListSkeleton } from './States'

/**
 * Game picker for a group: live games on top (join), the catalog below
 * (launch). Data and mutations live in `useActivities`; this only renders.
 */
export function ActivityLauncher({
  t,
  catalog,
  instances,
  state,
  busy,
  failed,
  onLaunch,
  onJoin,
  onClose,
  onRetry,
}: {
  t: Messages
  catalog: ActivityEntry[]
  instances: ActivityInstance[]
  state: LoadState
  busy: boolean
  failed: boolean
  onLaunch: (activityId: number) => void
  onJoin: (instanceId: number) => void
  onClose: () => void
  onRetry: () => void
}) {
  const nameOf = (id: number) => catalog.find((a) => a.id === id)?.name ?? `#${id}`

  return (
    <Modal onClose={onClose} className="modal social-modal" labelledBy="activity-launcher-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="activity-launcher-title">{t.activities}</h2>

      {state === 'loading' && <ListSkeleton rows={3} />}
      {state === 'error' && <ErrorState t={t} onRetry={onRetry} />}
      {state === 'ready' && (
        <>
          <p class="people-heading">
            {t.activeGames}
            {instances.length > 0 && <span class="count">{instances.length}</span>}
          </p>
          {instances.length === 0 ? (
            <p class="people-note">{t.noActiveGames}</p>
          ) : (
            <ul class="activity-list">
              {instances.map((i) => (
                <li key={i.id} class="activity-row">
                  <span class="activity-row-text">
                    <span class="people-row-label">{nameOf(i.activityId)}</span>
                  </span>
                  <button
                    type="button"
                    class="social-btn accent"
                    disabled={busy}
                    onClick={() => onJoin(i.id)}
                  >
                    {t.joinGame}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p class="people-heading">{t.activities}</p>
          {catalog.length === 0 ? (
            <p class="people-note">{t.noActivities}</p>
          ) : (
            <ul class="activity-list">
              {catalog.map((a) => (
                <li key={a.id} class="activity-row">
                  <span class="activity-row-icon" aria-hidden="true">
                    <Icon d={icons.game} size={20} />
                  </span>
                  <span class="activity-row-text">
                    <span class="people-row-label">{a.name}</span>
                    {a.description && <span class="people-row-sub">{a.description}</span>}
                  </span>
                  <button
                    type="button"
                    class="social-btn"
                    disabled={busy}
                    onClick={() => onLaunch(a.id)}
                  >
                    {t.playGame}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {failed && <p class="people-note error">{t.genericError}</p>}
    </Modal>
  )
}

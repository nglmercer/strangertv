import type { ComponentChildren } from 'preact'
import type { Messages } from '../../i18n'
import { Icon } from '../icons'

/** Neutral placeholder: an icon, a line of copy, and an optional action. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string
  title: string
  hint?: string
  action?: ComponentChildren
}) {
  return (
    <div class="state-block">
      <span class="state-icon" aria-hidden="true">
        <Icon d={icon} size={26} />
      </span>
      <p class="state-title">{title}</p>
      {hint && <p class="state-hint">{hint}</p>}
      {action}
    </div>
  )
}

/** Skeleton rows, so loading never looks like "you have nothing". */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div class="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div class="skeleton-row" key={i}>
          <span class="skeleton-avatar" />
          <span class="skeleton-lines">
            <i />
            <i class="short" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ t, onRetry }: { t: Messages; onRetry: () => void }) {
  return (
    <div class="state-block">
      <p class="state-title">{t.genericError}</p>
      <button type="button" class="social-btn" onClick={onRetry}>
        {t.retry}
      </button>
    </div>
  )
}

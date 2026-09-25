import { Icon, icons } from '../icons'
import type { ProfileLink } from '../../pages/profileMock'
import { DEFAULT_SECTION, hexA, isHexColor, type LinksSection } from './linksStore'

/**
 * Shared link section in the profile (dark) style: icon header with title,
 * count, and optional edit / add buttons, then the list in rows / compact /
 * grid layout. Used by the profile page and the editor's live preview so
 * both render identically; in the editor it doubles as the link selector.
 */
export function ProfileLinks({
  links,
  section = DEFAULT_SECTION,
  onEdit,
  selectedId,
  onSelect,
  onAdd,
  addDisabled,
}: {
  links: ProfileLink[]
  section?: LinksSection
  /** When provided, the header shows an edit button. TODO: owner only. */
  onEdit?: () => void
  /** Editor mode: highlights the selected link. Requires onSelect. */
  selectedId?: string | null
  /** Editor mode: clicking a link selects it for the edit card. */
  onSelect?: (id: string) => void
  /** Editor mode: the header shows an add button. */
  onAdd?: () => void
  addDisabled?: boolean
}) {
  const selectable = !!onSelect
  const cls = (base: string, id: string) =>
    selectable && id === selectedId ? `${base} is-selected` : base
  const current = (id: string) => (selectable && id === selectedId ? true : undefined)

  return (
    <div class="pflinks">
      <div class="pb-links-head">
        <span class="pb-links-head-icon" aria-hidden="true">
          <Icon d={section.icon} size={17} />
        </span>
        <h2 class="pb-links-head-title">{section.title || 'Links'}</h2>
        {section.showCount && <span class="pb-count">{links.length}</span>}
        {onAdd && (
          <button
            type="button"
            class="pb-links-add"
            aria-label="Add link"
            title={addDisabled ? 'Link limit reached' : 'Add link'}
            disabled={addDisabled}
            onClick={onAdd}
          >
            <Icon d={icons.plus} size={16} />
          </button>
        )}
        {onEdit && (
          <button type="button" class="pb-links-edit" aria-label="Edit links" onClick={onEdit}>
            <Icon d={icons.settings} size={16} />
          </button>
        )}
      </div>
      {links.length === 0 ? (
        <p class="pflinks-empty">No links yet.</p>
      ) : section.layout === 'grid' ? (
        <div class="pb-grid" role="list" aria-label="Links">
          {links.map((link) => (
            <button
              type="button"
              class={cls('pb-tile', link.id)}
              role="listitem"
              key={link.id}
              aria-current={current(link.id)}
              onClick={selectable ? () => onSelect?.(link.id) : undefined}
            >
              <LinkThumb link={link} className="pb-tile-thumb" iconSize={18} />
              <strong>{link.label || 'Untitled link'}</strong>
              <span class="pb-tile-desc">{link.desc}</span>
              <small>{link.domain}</small>
              <Icon d={icons.arrowRight} size={16} className="pb-tile-arrow" />
            </button>
          ))}
        </div>
      ) : (
        <section class={`pb-links${section.layout === 'compact' ? ' compact' : ''}`} aria-label="Links">
          {links.map((link) => (
            <button
              type="button"
              class={cls('pb-link', link.id)}
              key={link.id}
              aria-current={current(link.id)}
              onClick={selectable ? () => onSelect?.(link.id) : undefined}
            >
              <LinkThumb link={link} className="pb-link-thumb" iconSize={19} />
              <span class="pb-link-text">
                <strong>{link.label || 'Untitled link'}</strong>
                <span class="pb-link-desc">{link.desc}</span>
                <small>{link.domain}</small>
              </span>
              <Icon d={icons.arrowRight} size={18} className="pb-link-arrow" />
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

/**
 * Shared link thumbnail. Preset accents resolve through the `data-color`
 * stylesheet rules; custom hex colors render an equivalent inline tint.
 */
export function LinkThumb({
  link,
  className,
  iconSize,
}: {
  link: ProfileLink
  className: string
  iconSize: number
}) {
  const custom = isHexColor(link.color) ? link.color : null
  return (
    <span
      className={className}
      data-color={custom ? undefined : link.color}
      style={custom ? { background: hexA(custom, 0.16), color: custom } : undefined}
      aria-hidden="true"
    >
      <Icon d={link.icon} size={iconSize} />
    </span>
  )
}

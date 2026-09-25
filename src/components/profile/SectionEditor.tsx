import { Icon, icons } from '../icons'
import type { LinksLayout, LinksSection } from './linksStore'
import { EditorCard, FieldGroup, FieldRow, SelectField, TextField } from './EditorFields'

const SECTION_ICON_CHOICES = [
  { key: 'links', label: 'Links', path: icons.share },
  { key: 'globe', label: 'Globe', path: icons.globe },
  { key: 'star', label: 'Star', path: icons.star },
  { key: 'chat', label: 'Chat', path: icons.chatBubble },
] as const

const LAYOUT_CHOICES: Array<{ key: LinksLayout; label: string }> = [
  { key: 'rows', label: 'Rows' },
  { key: 'compact', label: 'Compact' },
  { key: 'grid', label: 'Grid' },
]

function iconKeyForPath(path: string): string {
  return SECTION_ICON_CHOICES.find((c) => c.path === path)?.key ?? 'links'
}

function iconPathForKey(key: string): string {
  return SECTION_ICON_CHOICES.find((c) => c.key === key)?.path ?? icons.share
}

function layoutLabelFor(layout: LinksLayout): string {
  return LAYOUT_CHOICES.find((c) => c.key === layout)?.label ?? 'Rows'
}

/**
 * Compact section summary with an edit button. Full settings live in
 * the SectionEditor modal, not inline.
 */
export function SectionSummary({
  section,
  count,
  onEdit,
}: {
  section: LinksSection
  count: number
  onEdit: () => void
}) {
  return (
    <EditorCard>
      <div class="pedit-summary">
        <span class="pedit-sumicon" aria-hidden="true">
          <Icon d={section.icon} size={18} />
        </span>
        <span class="pedit-summeta">
          <span class="pedit-sumtitle">{section.title || 'Links'}</span>
          <span class="pedit-sumsub">
            {layoutLabelFor(section.layout)} · {count} {count === 1 ? 'link' : 'links'}
          </span>
        </span>
        <button type="button" class="pedit-btn" onClick={onEdit}>
          <Icon d={icons.settings} size={15} />
          <span>Edit section</span>
        </button>
      </div>
    </EditorCard>
  )
}

/**
 * Section settings form: header title/icon, list layout, count toggle.
 * Renders inside the section modal; the dialog is already the card.
 */
export function SectionEditor({
  section,
  onChange,
}: {
  section: LinksSection
  onChange: (section: LinksSection) => void
}) {
  const set = (patch: Partial<LinksSection>) => onChange({ ...section, ...patch })

  return (
    <EditorCard>
      <TextField
        label="Title"
        value={section.title}
        maxLength={30}
        placeholder="Links"
        onInput={(value) => set({ title: value })}
      />
      <FieldRow>
        <SelectField
          label="Icon"
          value={iconKeyForPath(section.icon)}
          options={SECTION_ICON_CHOICES}
          onChange={(key) => set({ icon: iconPathForKey(key) })}
        />
        <FieldGroup label="Layout">
          <div class="pedit-seg" role="group" aria-label="Links layout">
            {LAYOUT_CHOICES.map((choice) => (
              <button
                key={choice.key}
                type="button"
                class={section.layout === choice.key ? 'is-on' : ''}
                aria-pressed={section.layout === choice.key}
                onClick={() => set({ layout: choice.key })}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </FieldGroup>
      </FieldRow>
      <label class="pedit-check">
        <input
          type="checkbox"
          checked={section.showCount}
          onChange={(e) => set({ showCount: e.currentTarget.checked })}
        />
        <span>Show link count</span>
      </label>
      <p class="pedit-hint">
        <Icon d={icons.eye} size={13} />
        <span>Changes preview live.</span>
      </p>
    </EditorCard>
  )
}

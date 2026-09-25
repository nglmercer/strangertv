import { Icon, icons } from '../icons'
import type { ProfileLink } from '../../pages/profileMock'
import { CustomIcons } from './CustomIcons'
import { LINK_COLORS, isHexColor, normalizeHex } from './linksStore'
import { EditorCard, FieldRow, SelectField, TextField } from './EditorFields'
import { mediaIdForIcon } from './linkIcons'

export const LINK_ICON_CHOICES = [
  { key: 'auto', label: 'Auto (domain favicon)' },
  { key: 'video', label: 'Video', path: icons.start },
  { key: 'photo', label: 'Photo', path: icons.camOn },
  { key: 'site', label: 'Website', path: icons.globe },
  { key: 'chat', label: 'Chat', path: icons.chatBubble },
  { key: 'star', label: 'Star', path: icons.star },
  { key: 'game', label: 'Game', path: icons.game },
] as const

/** Shown only while a custom upload is assigned, so the select names it. */
const CUSTOM_CHOICE = { key: 'custom', label: 'Custom upload' } as const

function iconKeyForValue(icon: string): string {
  if (icon === '') return 'auto'
  if (mediaIdForIcon(icon) != null) return 'custom'
  return LINK_ICON_CHOICES.find((c) => 'path' in c && c.path === icon)?.key ?? 'auto'
}

function iconValueForKey(key: string, current: string): string {
  if (key === 'auto') return ''
  if (key === 'custom') return current
  const found = LINK_ICON_CHOICES.find((c) => c.key === key)
  return found && 'path' in found ? found.path : ''
}

/**
 * Single-card editor for the selected link: reorder, fields, icon, and
 * accent. The parent owns the list, the selection, and persistence.
 */
export function LinkCard({
  link,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
  onDeleteIcon,
}: {
  link: ProfileLink
  index: number
  total: number
  onUpdate: (patch: Partial<ProfileLink>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  /** Clear a deleted upload from every link still referencing it. */
  onDeleteIcon: (id: number) => void
}) {
  const custom = isHexColor(link.color) ? link.color : null
  const iconKey = iconKeyForValue(link.icon)
  const iconOptions =
    iconKey === 'custom' ? [...LINK_ICON_CHOICES, CUSTOM_CHOICE] : LINK_ICON_CHOICES

  const onHexInput = (value: string) => {
    const hex = normalizeHex(value)
    if (hex) onUpdate({ color: hex })
  }

  return (
    <EditorCard>
      <div class="pedit-card-head">
        <p class="pedit-section-title">Edit link</p>
        <div class="pedit-card-actions">
          <button
            type="button"
            class="pedit-icon-btn"
            aria-label="Move link up"
            title="Move link up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <Icon d={icons.chevron} size={18} className="rot-180" />
          </button>
          <button
            type="button"
            class="pedit-icon-btn"
            aria-label="Move link down"
            title="Move link down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <Icon d={icons.chevron} size={18} />
          </button>
          <button
            type="button"
            class="pedit-icon-btn danger"
            aria-label="Delete link"
            title="Delete link"
            onClick={onRemove}
          >
            <Icon d={icons.close} size={16} />
          </button>
        </div>
      </div>
      <div class="pedit-accent">
        <span>Accent</span>
        <div class="pedit-swatches" role="radiogroup" aria-label="Accent color">
          {(Object.keys(LINK_COLORS) as Array<keyof typeof LINK_COLORS>).map((key) => (
            <button
              type="button"
              key={key}
              role="radio"
              aria-checked={link.color === key}
              aria-label={LINK_COLORS[key].label}
              title={LINK_COLORS[key].label}
              class={link.color === key ? 'pedit-swatch is-on' : 'pedit-swatch'}
              style={{ background: LINK_COLORS[key].fg }}
              onClick={() => onUpdate({ color: key })}
            />
          ))}
          <label
            class={custom ? 'pedit-swatch pedit-custom is-on' : 'pedit-swatch pedit-custom'}
            title="Custom color"
            style={custom ? { background: custom } : undefined}
          >
            <input
              type="color"
              value={custom ?? '#888888'}
              aria-label="Custom accent color"
              onInput={(e) => onUpdate({ color: e.currentTarget.value.toLowerCase() })}
            />
          </label>
        </div>
        <input
          key={`${link.id}:${link.color}`}
          class="pedit-hex"
          type="text"
          defaultValue={custom ?? ''}
          maxLength={7}
          placeholder="#hex"
          aria-label="Custom accent hex value"
          onInput={(e) => onHexInput(e.currentTarget.value)}
        />
      </div>
      <TextField
        label="Title"
        value={link.label}
        maxLength={60}
        placeholder="My awesome link"
        onInput={(value) => onUpdate({ label: value })}
      />
      <TextField
        label="Description"
        value={link.desc}
        maxLength={120}
        placeholder="What is this link about?"
        onInput={(value) => onUpdate({ desc: value })}
      />
      <FieldRow>
        <TextField
          label="Domain"
          value={link.domain}
          maxLength={80}
          placeholder="example.com"
          onInput={(value) => onUpdate({ domain: value })}
        />
        <SelectField
          label="Icon"
          value={iconKey}
          options={iconOptions}
          onChange={(key) => onUpdate({ icon: iconValueForKey(key, link.icon) })}
        />
      </FieldRow>
      <CustomIcons
        current={link.icon}
        onAssign={(icon) => onUpdate({ icon })}
        onDelete={onDeleteIcon}
      />
    </EditorCard>
  )
}

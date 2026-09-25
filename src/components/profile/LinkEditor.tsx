import { Icon, icons } from '../icons'
import type { ProfileLink } from '../../pages/profileMock'
import { LINK_COLORS, isHexColor, normalizeHex } from './linksStore'
import { EditorCard, FieldRow, SelectField, TextField } from './EditorFields'

export const LINK_ICON_CHOICES = [
  { key: 'video', label: 'Video', path: icons.start },
  { key: 'photo', label: 'Photo', path: icons.camOn },
  { key: 'site', label: 'Website', path: icons.globe },
  { key: 'chat', label: 'Chat', path: icons.chatBubble },
  { key: 'star', label: 'Star', path: icons.star },
  { key: 'game', label: 'Game', path: icons.game },
] as const

function iconKeyForPath(path: string): string {
  return LINK_ICON_CHOICES.find((c) => c.path === path)?.key ?? 'site'
}

function iconPathForKey(key: string): string {
  return LINK_ICON_CHOICES.find((c) => c.key === key)?.path ?? icons.globe
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
}: {
  link: ProfileLink
  index: number
  total: number
  onUpdate: (patch: Partial<ProfileLink>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const custom = isHexColor(link.color) ? link.color : null

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
          value={iconKeyForPath(link.icon)}
          options={LINK_ICON_CHOICES}
          onChange={(key) => onUpdate({ icon: iconPathForKey(key) })}
        />
      </FieldRow>
    </EditorCard>
  )
}

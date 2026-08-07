import { Icon, icons } from '../icons'

/** Stable per-name hue so a person keeps the same colour everywhere. */
function hue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}

export function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

/**
 * Round identity chip: initials on a name-derived colour for people, a glyph
 * for groups, with an optional presence dot.
 */
export function Avatar({
  name,
  kind = 'user',
  size = 40,
  presence,
}: {
  name: string
  kind?: 'user' | 'group'
  size?: number
  presence?: 'online' | 'offline'
}) {
  const h = hue(name || '?')
  return (
    <span
      class={`avatar avatar-${kind}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.36)}px`,
        background: kind === 'group' ? undefined : `hsl(${h} 42% 32%)`,
        color: kind === 'group' ? undefined : `hsl(${h} 80% 88%)`,
      }}
      aria-hidden="true"
    >
      {kind === 'group' ? <Icon d={icons.users} size={Math.round(size * 0.5)} /> : initials(name)}
      {presence && <i class={`presence ${presence}`} />}
    </span>
  )
}

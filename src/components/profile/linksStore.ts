import { icons } from '../icons'
import { PROFILE_LINKS, type ProfileLink } from '../../pages/profileMock'

/**
 * Link storage for the profile drafts. Defaults come from the shared mock;
 * edits persist per-handle in localStorage until a real API wires in.
 */
const linksKeyFor = (handle: string) => `profile-links:${handle.toLowerCase()}`
const sectionKeyFor = (handle: string) => `profile-section:${handle.toLowerCase()}`

export type LinksLayout = 'rows' | 'compact' | 'grid'

export type LinksSection = {
  title: string
  icon: string
  layout: LinksLayout
  showCount: boolean
}

export const DEFAULT_SECTION: LinksSection = {
  title: 'Links',
  icon: icons.share,
  layout: 'rows',
  showCount: true,
}

const LAYOUTS: LinksLayout[] = ['rows', 'compact', 'grid']

/** Max links the editor allows; the add button disables at this count. */
export const MAX_LINKS = 8

/**
 * Pure reorder: moves the item at `from` by `dir`. Returns the input
 * untouched at the list ends or out of range.
 */
export function moveLink(links: ProfileLink[], from: number, dir: -1 | 1): ProfileLink[] {
  const to = from + dir
  if (from < 0 || to < 0 || to >= links.length) return links
  const next = [...links]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/**
 * Id to select after removing `id`: the next sibling, else the
 * previous, else null when nothing remains or the id is unknown.
 */
export function selectionAfterRemove(links: ProfileLink[], id: string): string | null {
  const at = links.findIndex((link) => link.id === id)
  if (at < 0) return null
  return links[at + 1]?.id ?? links[at - 1]?.id ?? null
}

/** Dark-safe thumbnail accents, keyed by `ProfileLink.color` preset. */
export const LINK_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  gray: { bg: '#ffffff10', fg: '#bbbbbb', label: 'Gray' },
  green: { bg: '#1e3a31', fg: '#9eecc8', label: 'Green' },
  orange: { bg: 'rgba(241, 106, 66, 0.16)', fg: '#f16a42', label: 'Orange' },
  blue: { bg: 'rgba(122, 162, 255, 0.16)', fg: '#8ab4ff', label: 'Blue' },
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

/** Accepts `#rrggbb`, `rrggbb`, `#rgb`, `rgb`; returns `#rrggbb` or null. */
export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '')
  const full = /^[0-9a-f]{3}$/i.test(hex)
    ? hex
        .split('')
        .map((c) => c + c)
        .join('')
    : hex
  return /^[0-9a-f]{6}$/i.test(full) ? `#${full.toLowerCase()}` : null
}

/** Builds an `rgba()` tint from a `#rrggbb` color for thumbnail backgrounds. */
export function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function cleanLink(value: unknown): ProfileLink | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  const rawColor = typeof o.color === 'string' ? o.color : ''
  return {
    id: o.id,
    label: typeof o.label === 'string' ? o.label.slice(0, 60) : '',
    desc: typeof o.desc === 'string' ? o.desc.slice(0, 120) : '',
    domain: typeof o.domain === 'string' ? o.domain.slice(0, 80) : '',
    icon: typeof o.icon === 'string' && o.icon ? o.icon : icons.globe,
    color: LINK_COLORS[rawColor] ? rawColor : (normalizeHex(rawColor) ?? 'gray'),
  }
}

export function loadLinks(handle: string): ProfileLink[] {
  try {
    const raw = localStorage.getItem(linksKeyFor(handle))
    if (!raw) return PROFILE_LINKS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return PROFILE_LINKS
    return parsed.flatMap((item) => {
      const link = cleanLink(item)
      return link ? [link] : []
    })
  } catch {
    return PROFILE_LINKS
  }
}

export function saveLinks(handle: string, links: ProfileLink[]) {
  try {
    localStorage.setItem(linksKeyFor(handle), JSON.stringify(links))
  } catch {
    /* private mode / quota: edits stay in memory */
  }
}

export function loadSection(handle: string): LinksSection {
  try {
    const raw = localStorage.getItem(sectionKeyFor(handle))
    if (!raw) return DEFAULT_SECTION
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object') return DEFAULT_SECTION
    return {
      title: typeof o.title === 'string' ? o.title.slice(0, 30) : DEFAULT_SECTION.title,
      icon: typeof o.icon === 'string' && o.icon ? o.icon : DEFAULT_SECTION.icon,
      layout: LAYOUTS.includes(o.layout as LinksLayout) ? (o.layout as LinksLayout) : 'rows',
      showCount: o.showCount !== false,
    }
  } catch {
    return DEFAULT_SECTION
  }
}

export function saveSection(handle: string, section: LinksSection) {
  try {
    localStorage.setItem(sectionKeyFor(handle), JSON.stringify(section))
  } catch {
    /* private mode / quota: edits stay in memory */
  }
}

export function blankLink(): ProfileLink {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `l-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  return { id, label: '', desc: '', domain: '', icon: icons.globe, color: 'gray' }
}

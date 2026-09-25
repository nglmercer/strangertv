import { icons } from '../components/icons'

/**
 * Profile display helpers plus the offline link seed. Header identity, stats,
 * and follow state all come from the profile API; `PROFILE_LINKS` only seeds
 * the local store when the server is unreachable (offline dev).
 */
export type ProfileLink = {
  id: string
  label: string
  desc: string
  domain: string
  icon: string
  color: string
}

export const PROFILE_LINKS: ProfileLink[] = [
  { id: 'l1', label: 'Stream clips', desc: 'Best moments from this week’s matches', domain: 'clips.meme.dev', icon: icons.start, color: 'green' },
  { id: 'l2', label: 'Photo gallery', desc: '128 shots, updated every week', domain: 'pics.meme.dev', icon: icons.camOn, color: 'orange' },
  { id: 'l3', label: 'Personal site', desc: 'Blog, projects and contact', domain: 'meme.dev', icon: icons.globe, color: 'gray' },
]

export function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

export function identity(handle?: string): { name: string; display: string } {
  const name = handle?.trim() || 'meme'
  return { name, display: name[0]!.toUpperCase() + name.slice(1) }
}

/** Social-style compact counts: 1204 -> "1.2K". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${trimCount(n / 1_000_000)}M`
  if (n >= 1_000) return `${trimCount(n / 1_000)}K`
  return String(n)
}

/**
 * Join date for the meta line: "Mar 2023". Accepts SQLite `CURRENT_TIMESTAMP`
 * (`YYYY-MM-DD HH:MM:SS`, UTC) and ISO strings; unparseable input passes
 * through untouched.
 */
export function formatJoined(value: string): string {
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return value
  return at.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function trimCount(v: number): string {
  return String(Math.round(v * 10) / 10)
}

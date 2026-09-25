import { icons } from '../components/icons'

/**
 * Design-only mock shared by the profile page, the link editor, and the
 * link store. Wiring to a real profile API is a follow-up.
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

export const PROFILE = {
  bio: 'Night owl. I match to practice languages and trade music recs.',
  country: 'Peru',
  languages: 'ES · EN',
  website: 'meme.dev',
  joined: 'Mar 2023',
  verified: true,
  stats: { friends: 128, followers: 1204, following: 86 },
  online: true,
  mutuals: ['Ana', 'Leo', 'Kim'],
  mutualsExtra: 9,
}

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

function trimCount(v: number): string {
  return String(Math.round(v * 10) / 10)
}

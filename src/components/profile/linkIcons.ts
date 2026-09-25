import { API_ROUTES } from '../../../shared/constants'

/**
 * Link icon resolution: favicon-first.
 *
 * A link's `icon` value is one of three shapes:
 * - `''` (empty): automatic — the icon resolves from the link's domain
 *   favicon, so github.com, youtube.com, tiktok.com, and every other domain
 *   render their real brand mark with zero maintenance.
 * - `'media:<id>'`: a user-uploaded custom icon served by the media API.
 * - anything else: a legacy built-in SVG path rendered by `Icon`.
 */
export const MEDIA_ICON_PREFIX = 'media:'

/** `https://github.com/org/repo` -> `github.com`. Bare domains pass through. */
export function domainHost(domain: string): string {
  return domain
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split('/')[0]!
    .trim()
}

/** Brand mark for any domain via the favicon service. */
export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainHost(domain))}&sz=64`
}

/** `media:12` -> 12; anything else (or a bad id) -> null. */
export function mediaIdForIcon(icon: string): number | null {
  if (!icon.startsWith(MEDIA_ICON_PREFIX)) return null
  const id = Number(icon.slice(MEDIA_ICON_PREFIX.length))
  return Number.isInteger(id) && id > 0 ? id : null
}

export type ResolvedIcon =
  | { kind: 'favicon'; src: string }
  | { kind: 'media'; src: string }
  | { kind: 'path'; path: string }

/** Resolve a stored icon value to something renderable. */
export function resolveLinkIcon(icon: string, domain: string): ResolvedIcon {
  if (icon === '') return { kind: 'favicon', src: faviconUrl(domain) }
  const mediaId = mediaIdForIcon(icon)
  if (mediaId != null) return { kind: 'media', src: API_ROUTES.mediaById(mediaId) }
  return { kind: 'path', path: icon }
}

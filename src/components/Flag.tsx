import type { JSX } from 'preact'
import { Icon, icons } from './icons'

/**
 * Inline SVG flags for the handful of countries we offer.
 *
 * Deliberately not emoji flags: Windows ships no flag glyphs, so `🇵🇪` renders
 * as bare letters there. Deliberately not a flag icon package either — twelve
 * hand-drawn 24×16 flags cost less than a 250-country sprite, and they are
 * simplified on purpose (crests and stars read as noise at 18px).
 */
const flags: Record<string, JSX.Element> = {
  PE: (
    <>
      <rect width="8" height="16" fill="#d91023" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#d91023" />
    </>
  ),
  US: (
    <>
      <rect width="24" height="16" fill="#fff" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} y={i * 2.46} width="24" height="1.23" fill="#b22234" />
      ))}
      <rect width="10" height="8.6" fill="#3c3b6e" />
    </>
  ),
  MX: (
    <>
      <rect width="8" height="16" fill="#006847" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#ce1126" />
      <circle cx="12" cy="8" r="2.1" fill="#8c6239" />
    </>
  ),
  ES: (
    <>
      <rect width="24" height="16" fill="#c60b1e" />
      <rect y="4" width="24" height="8" fill="#ffc400" />
    </>
  ),
  BR: (
    <>
      <rect width="24" height="16" fill="#009b3a" />
      <path d="M12 2.2 21.6 8 12 13.8 2.4 8z" fill="#fedf00" />
      <circle cx="12" cy="8" r="3.1" fill="#002776" />
    </>
  ),
  AR: (
    <>
      <rect width="24" height="16" fill="#74acdf" />
      <rect y="5.34" width="24" height="5.32" fill="#fff" />
      <circle cx="12" cy="8" r="1.7" fill="#f6b40e" />
    </>
  ),
  CO: (
    <>
      <rect width="24" height="16" fill="#fcd116" />
      <rect y="8" width="24" height="4" fill="#003893" />
      <rect y="12" width="24" height="4" fill="#ce1126" />
    </>
  ),
  CL: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#d52b1e" />
      <rect width="8" height="8" fill="#0039a6" />
      <path d="m4 2.2.86 2.6h2.7l-2.2 1.6.85 2.6L4 7.4 1.8 9l.85-2.6-2.2-1.6h2.7z" fill="#fff" />
    </>
  ),
  GB: (
    <>
      <rect width="24" height="16" fill="#012169" />
      <path d="M0 0 24 16M24 0 0 16" stroke="#fff" stroke-width="3.2" />
      <path d="M0 0 24 16M24 0 0 16" stroke="#c8102e" stroke-width="1.9" />
      <path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="5.3" />
      <path d="M12 0v16M0 8h24" stroke="#c8102e" stroke-width="3.2" />
    </>
  ),
  DE: (
    <>
      <rect width="24" height="16" fill="#000" />
      <rect y="5.34" width="24" height="5.33" fill="#dd0000" />
      <rect y="10.67" width="24" height="5.33" fill="#ffce00" />
    </>
  ),
  FR: (
    <>
      <rect width="8" height="16" fill="#002395" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#ed2939" />
    </>
  ),
  JP: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <circle cx="12" cy="8" r="4.4" fill="#bc002d" />
    </>
  ),
}

export function hasFlag(code: string): boolean {
  return code in flags
}

/** Flag for a country code; falls back to the globe for "any"/unknown codes. */
export function Flag({ code, size = 18 }: { code: string; size?: number }) {
  const art = flags[code]
  if (!art) return <Icon d={icons.globe} size={size} />
  return (
    <svg
      class="flag"
      width={size}
      height={Math.round((size * 2) / 3)}
      viewBox="0 0 24 16"
      aria-hidden="true"
      role="presentation"
    >
      <defs>
        <clipPath id={`flag-clip-${code}`}>
          <rect width="24" height="16" rx="2.5" />
        </clipPath>
      </defs>
      <g clip-path={`url(#flag-clip-${code})`}>{art}</g>
      <rect width="24" height="16" rx="2.5" fill="none" stroke="#0006" stroke-width="1" />
    </svg>
  )
}

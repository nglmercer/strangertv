import { useEffect, useRef, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { Icon, icons } from '../components/icons'
import { ProfileLinks } from '../components/profile/ProfileLinks'
import { loadLinks, loadSection } from '../components/profile/linksStore'
import { PROFILE, formatCount, identity, initials, type ProfileLink } from './profileMock'
import type { LinksSection } from '../components/profile/linksStore'
import { followLabel, useFollow } from './ProfileActions'

type ProfilePageProps = {
  path?: string
  /** From the `/u/:handle` route. Design-only: seeds the mock identity. */
  handle?: string
}

/**
 * Public profile page. Dark header with icon actions (overflow, message on
 * mutual, bell), hover tooltips, overflow dropdown menu, follow pill with
 * shared follow states, and the shared customizable link section. Links and
 * section settings persist per-handle in localStorage until a real API
 * wires in.
 */
export function ProfilePage({ handle }: ProfilePageProps) {
  const { name, display } = identity(handle)
  const follow = useFollow()
  const mutual = follow.status === 'mutual'
  const following = follow.status === 'following' || mutual
  const [links] = useState<ProfileLink[]>(() => loadLinks(name))
  const [section] = useState<LinksSection>(() => loadSection(name))

  const [menuOpen, setMenuOpen] = useState(false)
  const [notify, setNotify] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const copyLink = async () => {
    const url = `${location.origin}/u/${name}`
    try {
      if (!navigator.clipboard?.writeText) return
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable: leave the item unchanged */
    }
  }

  return (
    <div class="pd-page">
      <div class="pd-col">
        <header class="pb-top">
          <button type="button" class="pb-ghost" onClick={() => route('/', true)}>
            <Icon d={icons.arrowLeft} size={18} />
            <span>Back</span>
          </button>
          <span class="pb-handle">@{name}</span>
          <button type="button" class="pb-ghost pb-icon" title="Copy profile link (design mock)">
            <Icon d={icons.share} size={18} />
          </button>
        </header>

        <section class="pd-head" aria-label="Profile">
          <div class="pd-idrow">
            <span class={`pd-avatar${PROFILE.online ? ' is-online' : ''}`} aria-hidden="true">
              {initials(display)}
            </span>
            <div class="pd-actions pact-dark">
              <div class="pd-overflow" ref={menuRef}>
                <button
                  type="button"
                  class="pd-icon"
                  data-tip="More"
                  aria-label="More actions"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <Icon d={icons.more} size={19} />
                </button>
                {menuOpen && (
                  <div class="pd-menu" role="menu">
                    <button type="button" role="menuitem" class="pd-menu-item" onClick={() => setMenuOpen(false)}>
                      <Icon d={icons.eye} size={18} />
                      <span>About this account</span>
                    </button>
                    <button type="button" role="menuitem" class="pd-menu-item" onClick={() => void copyLink()}>
                      <Icon d={copied ? icons.check : icons.share} size={18} />
                      <span>{copied ? 'Copied!' : 'Copy profile link'}</span>
                    </button>
                    <button type="button" role="menuitem" class="pd-menu-item" onClick={() => setMenuOpen(false)}>
                      <Icon d={icons.block} size={18} />
                      <span>Block @{name}</span>
                    </button>
                    <button type="button" role="menuitem" class="pd-menu-item" onClick={() => setMenuOpen(false)}>
                      <Icon d={icons.report} size={18} />
                      <span>Report @{name}</span>
                    </button>
                  </div>
                )}
              </div>
              {mutual && (
                <button
                  type="button"
                  class="pd-icon"
                  data-tip="Message"
                  aria-label="Send message"
                  title="Send message (design mock)"
                >
                  <Icon d={icons.chatBubble} size={18} />
                </button>
              )}
              <button
                type="button"
                class={`pd-icon${notify ? ' is-on' : ''}`}
                data-tip={notify ? 'Notifications on' : 'Notifications off'}
                aria-label="Toggle notifications"
                aria-pressed={notify}
                onClick={() => setNotify((v) => !v)}
              >
                <Icon d={icons.bell} size={18} />
              </button>
              <button
                type="button"
                class={following ? 'pact-follow is-following pd-pill' : 'pact-follow pd-pill'}
                onClick={follow.toggleIFollow}
              >
                {mutual && <Icon d={icons.check} size={15} className="pact-check" />}
                <span class="pact-label">{followLabel(follow.status)}</span>
                <span class="pact-label-hover">Unfollow</span>
              </button>
            </div>
          </div>

          <div class="pd-names">
            <h1 class="pd-name">
              {display}
              {PROFILE.verified && (
                <span class="verified" title="Verified">
                  <Icon d={icons.check} size={11} />
                </span>
              )}
            </h1>
            <p class="pd-handleline">@{name}</p>
          </div>
          <p class="pd-bio">{PROFILE.bio}</p>
          <p class="pd-linkline">
            <span class="u-link u-link-dark">{PROFILE.website}</span>
          </p>
          <p class="pd-meta">
            {PROFILE.country} · Joined {PROFILE.joined}
          </p>

          <div class="pd-stats" aria-label="Stats">
            <span>
              <strong>{formatCount(PROFILE.stats.following)}</strong> Following
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong title={String(PROFILE.stats.followers + (follow.iFollow ? 1 : 0))}>
                {formatCount(PROFILE.stats.followers + (follow.iFollow ? 1 : 0))}
              </strong>{' '}
              Followers
            </span>
          </div>

          <div class="mutuals mutuals-dark mutuals-start">
            <span class="mutual-stack" aria-hidden="true">
              {PROFILE.mutuals.map((m) => (
                <span key={m}>{initials(m)}</span>
              ))}
            </span>
            {follow.status === 'mutual' ? (
              <span>You follow each other</span>
            ) : (
              <span>
                Followed by <b>{PROFILE.mutuals.slice(0, 2).join(', ')}</b> and {PROFILE.mutualsExtra} others
              </span>
            )}
          </div>
        </section>

        <ProfileLinks links={links} section={section} onEdit={() => route(`/u/${name}/edit`)} />
      </div>
    </div>
  )
}

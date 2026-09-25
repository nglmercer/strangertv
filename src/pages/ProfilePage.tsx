import { useEffect, useRef, useState } from 'preact/hooks'
import { route } from 'preact-router'
import type { ProfileHeaderDTO, ReportReason } from '../../shared/types'
import { errorStatus, getStoredUser, profilesApi, socialApi } from '../api'
import { AuthModal } from '../components/AuthModal'
import { Icon, icons } from '../components/icons'
import { FollowListsModal, type FollowTab } from '../components/profile/FollowLists'
import { ProfileLinks } from '../components/profile/ProfileLinks'
import { ReportModal } from '../components/ReportModal'
import {
  dtoToLinks,
  dtoToSection,
  hasLocalDoc,
  loadLinks,
  loadSection,
} from '../components/profile/linksStore'
import { countryLabel, detectLocale, t } from '../i18n'
import { formatCount, formatJoined, identity, initials, type ProfileLink } from './profileMock'
import type { LinksSection } from '../components/profile/linksStore'
import { followLabel, useFollow } from './ProfileActions'

type ProfilePageProps = {
  path?: string
  /** From the `/u/:handle` route. Resolves the account; seeds the fallback header. */
  handle?: string
}

function websiteHref(website: string): string {
  return website.startsWith('http://') || website.startsWith('https://')
    ? website
    : `https://${website}`
}

/**
 * Public profile page. Dark header with icon actions (overflow, message on
 * mutual, bell), hover tooltips, overflow dropdown menu, follow pill with
 * live follow states, and the shared customizable link section. Identity,
 * stats, follow state, links, and section load from the profile API; local
 * drafts render only when the API is unreachable (offline dev). The edit
 * shortcut shows for the owner only.
 */
export function ProfilePage({ handle }: ProfilePageProps) {
  const { name, display: fallbackDisplay } = identity(handle)
  const [links, setLinks] = useState<ProfileLink[]>(() => loadLinks(name))
  const [section, setSection] = useState<LinksSection>(() => loadSection(name))
  const [ownerId, setOwnerId] = useState<number | null>(null)
  const [header, setHeader] = useState<ProfileHeaderDTO | null>(null)
  const [missing, setMissing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [messages] = useState(() => t(detectLocale()))

  useEffect(() => {
    let live = true
    setMissing(false)
    setLoaded(false)
    setHeader(null)
    setOwnerId(null)
    profilesApi.getByUsername(name).then(
      (doc) => {
        if (!live) return
        setLinks(dtoToLinks(doc.links))
        setSection(dtoToSection(doc.section))
        setHeader(doc.header)
        setOwnerId(doc.userId)
        setLoaded(true)
      },
      (error) => {
        if (!live) return
        // Unknown handle: not-found page. Anything else (offline dev
        // without a server): keep the local drafts painted above.
        if (errorStatus(error) === 404) setMissing(true)
        setLoaded(true)
      },
    )
    return () => {
      live = false
    }
  }, [name])

  const stored = getStoredUser()
  const isOwner = stored != null && ownerId != null && stored.id === ownerId

  const [authOpen, setAuthOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [listsTab, setListsTab] = useState<FollowTab | null>(null)
  const follow = useFollow(ownerId, () => setAuthOpen(true))
  const mutual = follow.status === 'mutual'
  const following = follow.status === 'following' || mutual

  const display = header?.displayName || fallbackDisplay
  const followers = (header?.followerCount ?? 0) + follow.countDelta
  const followingCount = header?.followingCount ?? 0
  const mutualNames = follow.mutuals.map((u) => u.displayName || u.username || 'Someone')
  const showMutuals = stored != null && (mutual || mutualNames.length > 0)
  const metaParts: string[] = []
  if (header?.country && header.country !== 'any') metaParts.push(countryLabel(messages, header.country))
  if (header?.joinedAt) metaParts.push(`Joined ${formatJoined(header.joinedAt)}`)

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

  const blockUser = () => {
    setMenuOpen(false)
    if (ownerId == null || blocked) return
    if (getStoredUser() == null) {
      setAuthOpen(true)
      return
    }
    socialApi.block(ownerId).then(
      () => setBlocked(true),
      () => {
        /* keep the menu item: the next open retries */
      },
    )
  }

  const openReport = () => {
    setMenuOpen(false)
    if (ownerId == null) return
    if (getStoredUser() == null) {
      setAuthOpen(true)
      return
    }
    setReportOpen(true)
  }

  const submitReport = (reason: ReportReason, detail: string) => {
    setReportOpen(false)
    socialApi.report(reason, detail || undefined).then(
      () => {},
      () => {},
    )
  }

  if (missing) {
    return (
      <div class="pd-page">
        <div class="pd-col pd-missing">
          <h1 class="pd-name">@{name} doesn&apos;t exist</h1>
          <p class="pd-bio">This profile link is broken or the username changed.</p>
          <button type="button" class="pb-ghost" onClick={() => route('/', true)}>
            <Icon d={icons.arrowLeft} size={18} />
            <span>Back home</span>
          </button>
        </div>
      </div>
    )
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
          <button type="button" class="pb-ghost pb-icon" title="Copy profile link" onClick={() => void copyLink()}>
            <Icon d={icons.share} size={18} />
          </button>
        </header>

        <section class="pd-head" aria-label="Profile">
          <div class="pd-idrow">
            {header?.avatarUrl ? (
              <img class="pd-avatar-img" src={header.avatarUrl} alt="" width={132} height={132} />
            ) : (
              <span class="pd-avatar" aria-hidden="true">
                {initials(display)}
              </span>
            )}
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
                    <button type="button" role="menuitem" class="pd-menu-item" onClick={() => void copyLink()}>
                      <Icon d={copied ? icons.check : icons.share} size={18} />
                      <span>{copied ? 'Copied!' : 'Copy profile link'}</span>
                    </button>
                    {!isOwner && (
                      <button
                        type="button"
                        role="menuitem"
                        class="pd-menu-item"
                        disabled={blocked}
                        onClick={blockUser}
                      >
                        <Icon d={blocked ? icons.check : icons.block} size={18} />
                        <span>{blocked ? `Blocked @${name}` : `Block @${name}`}</span>
                      </button>
                    )}
                    {!isOwner && (
                      <button type="button" role="menuitem" class="pd-menu-item" onClick={openReport}>
                        <Icon d={icons.report} size={18} />
                        <span>Report @{name}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              {mutual && (
                <button
                  type="button"
                  class="pd-icon"
                  data-tip="Message"
                  aria-label="Send message"
                  title="Open messages"
                  onClick={() => route('/social')}
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
              {isOwner ? (
                <button
                  type="button"
                  class="pact-follow pd-pill"
                  onClick={() => route(`/u/${name}/edit`)}
                >
                  <span class="pact-label">Edit profile</span>
                </button>
              ) : (
                <button
                  type="button"
                  class={following ? 'pact-follow is-following pd-pill' : 'pact-follow pd-pill'}
                  disabled={ownerId == null || follow.pending}
                  onClick={follow.toggleIFollow}
                >
                  {mutual && <Icon d={icons.check} size={15} className="pact-check" />}
                  <span class="pact-label">{followLabel(follow.status)}</span>
                  <span class="pact-label-hover">Unfollow</span>
                </button>
              )}
            </div>
          </div>

          <div class="pd-names">
            <h1 class="pd-name">{display}</h1>
            <p class="pd-handleline">@{name}</p>
          </div>
          {header?.bio && <p class="pd-bio">{header.bio}</p>}
          {header?.website && (
            <p class="pd-linkline">
              <a
                class="u-link u-link-dark"
                href={websiteHref(header.website)}
                target="_blank"
                rel="noreferrer"
              >
                {header.website}
              </a>
            </p>
          )}
          {metaParts.length > 0 && <p class="pd-meta">{metaParts.join(' · ')}</p>}

          <div class="pd-stats" aria-label="Stats">
            <button
              type="button"
              class="pd-stat"
              disabled={ownerId == null}
              onClick={() => setListsTab('following')}
            >
              <strong>{formatCount(followingCount)}</strong> Following
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              class="pd-stat"
              disabled={ownerId == null}
              onClick={() => setListsTab('followers')}
            >
              <strong title={String(followers)}>{formatCount(followers)}</strong> Followers
            </button>
          </div>

          {showMutuals && (
            <div class="mutuals mutuals-dark mutuals-start">
              <span class="mutual-stack" aria-hidden="true">
                {follow.mutuals.map((u) => (
                  <span key={u.id}>{initials(u.displayName || u.username || '?')}</span>
                ))}
              </span>
              {mutual ? (
                <span>You follow each other</span>
              ) : (
                <span>
                  Followed by <b>{mutualNames.slice(0, 2).join(', ')}</b>
                  {mutualNames.length > 2 && ` and ${mutualNames.length - 2} others`}
                </span>
              )}
            </div>
          )}
        </section>

        {!loaded && !hasLocalDoc(name) ? (
          <p class="pedit-muted">Loading links…</p>
        ) : (
          <ProfileLinks
            links={links}
            section={section}
            onEdit={isOwner ? () => route(`/u/${name}/edit`) : undefined}
          />
        )}

        {listsTab != null && ownerId != null && (
          <FollowListsModal userId={ownerId} tab={listsTab} onClose={() => setListsTab(null)} />
        )}
        {authOpen && (
          <AuthModal
            t={messages}
            onClose={() => setAuthOpen(false)}
            onAuth={() => {
              setAuthOpen(false)
              follow.refresh()
            }}
          />
        )}
        {reportOpen && (
          <ReportModal t={messages} onClose={() => setReportOpen(false)} onSubmit={submitReport} />
        )}
      </div>
    </div>
  )
}

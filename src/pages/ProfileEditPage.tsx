import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { route } from 'preact-router'
import {
  authApi,
  errorStatus,
  profilesApi,
  setStoredUser,
  type PublicUser,
} from '../api'
import { AuthModal } from '../components/AuthModal'
import { detectLocale, t as translate } from '../i18n'
import { Icon, icons } from '../components/icons'
import { Modal } from '../components/Modal'
import { EditorCard } from '../components/profile/EditorFields'
import { LinkCard } from '../components/profile/LinkEditor'
import { ProfileLinks } from '../components/profile/ProfileLinks'
import { SectionEditor, SectionSummary } from '../components/profile/SectionEditor'
import { UsernameCard } from '../components/profile/UsernameCard'
import { AvatarCard } from '../components/profile/AvatarCard'
import { ProfileHeaderCard } from '../components/profile/ProfileHeaderCard'
import { MEDIA_ICON_PREFIX } from '../components/profile/linkIcons'
import {
  MAX_LINKS,
  blankLink,
  docKey,
  docToSave,
  dtoToHeader,
  dtoToLinks,
  dtoToSection,
  hasLocalDoc,
  loadHeader,
  loadLinks,
  loadSection,
  moveLink,
  saveHeader,
  saveLinks,
  saveSection,
  selectionAfterRemove,
} from '../components/profile/linksStore'
import type { LinksSection, ProfileHeaderDraft } from '../components/profile/linksStore'
import { identity, type ProfileLink } from './profileMock'

type ProfileEditPageProps = {
  path?: string
  handle?: string
}

type Session = { status: 'loading' } | { status: 'guest' } | { status: 'ready'; user: PublicUser }

function TopBar({ name, children }: { name: string; children?: ComponentChildren }) {
  return (
    <header class="pedit-top">
      <button type="button" class="pedit-back" onClick={() => route(`/u/${name}`, true)}>
        <Icon d={icons.arrowLeft} size={18} />
        <span>Back to profile</span>
      </button>
      <h1 class="pedit-title">Edit profile</h1>
      {children ?? <span class="pedit-saved" />}
    </header>
  )
}

/**
 * Link editor page. Gates on session + ownership, then edits the server doc
 * with debounced autosave (local drafts stay as the offline cache).
 */
export function ProfileEditPage({ handle }: ProfileEditPageProps) {
  const { name } = identity(handle)
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const [authOpen, setAuthOpen] = useState(false)

  useEffect(() => {
    let live = true
    authApi.me().then(
      ({ user }) => {
        if (!live) return
        setStoredUser(user)
        setSession({ status: 'ready', user })
      },
      () => {
        if (live) setSession({ status: 'guest' })
      },
    )
    return () => {
      live = false
    }
  }, [])

  const rename = async (user: PublicUser, next: string): Promise<string | null> => {
    try {
      const { username } = await profilesApi.setUsername(next)
      const updated = { ...user, username }
      setStoredUser(updated)
      setSession({ status: 'ready', user: updated })
      route(`/u/${username}/edit`, true)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not save.'
    }
  }

  if (session.status === 'loading') {
    return (
      <div class="pedit-page">
        <div class="pedit-col">
          <TopBar name={name} />
          <p class="pedit-muted">Loading…</p>
        </div>
      </div>
    )
  }

  if (session.status === 'guest') {
    return (
      <div class="pedit-page">
        <div class="pedit-col">
          <TopBar name={name} />
          <EditorCard>
            <div class="pedit-center">
              <p class="pedit-section-title">Sign in required</p>
              <p class="pedit-muted">Sign in to edit your links. New here? You can register next.</p>
              <button type="button" class="pedit-btn primary" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            </div>
          </EditorCard>
          {authOpen && (
            <AuthModal
              t={translate(detectLocale())}
              onClose={() => setAuthOpen(false)}
              onAuth={(user) => {
                setAuthOpen(false)
                setSession({ status: 'ready', user })
              }}
            />
          )}
        </div>
      </div>
    )
  }

  const { user } = session
  if (user.username?.toLowerCase() !== name.toLowerCase()) {
    if (!user.username) {
      return (
        <div class="pedit-page">
          <div class="pedit-col">
            <TopBar name={name} />
            <EditorCard>
              <div class="pedit-center">
                <p class="pedit-section-title">Claim your handle</p>
                <p class="pedit-muted">Pick the username your public profile will live at.</p>
              </div>
            </EditorCard>
            <UsernameCard username="" onRename={(next) => rename(user, next)} />
          </div>
        </div>
      )
    }
    return (
      <div class="pedit-page">
        <div class="pedit-col">
          <TopBar name={name} />
          <EditorCard>
            <div class="pedit-center">
              <p class="pedit-section-title">Not your profile</p>
              <p class="pedit-muted">This is @{name}&rsquo;s editor.</p>
              <button
                type="button"
                class="pedit-btn primary"
                onClick={() => route(`/u/${user.username}/edit`, true)}
              >
                Open my editor
              </button>
            </div>
          </EditorCard>
        </div>
      </div>
    )
  }

  return <Editor key={name} user={user} name={name} onRename={(next) => rename(user, next)} />
}

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error'

/**
 * The editor itself. Left column: profile address, section summary (settings
 * in a modal), one edit card for the selected link. Right column is the
 * shared section component doubling as the link selector. Edits autosave to
 * the API; the echo is ignored (positions are authoritative) and local
 * drafts stay in sync as the offline cache.
 */
function Editor({
  user,
  name,
  onRename,
}: {
  user: PublicUser
  name: string
  onRename: (next: string) => Promise<string | null>
}) {
  const [links, setLinks] = useState<ProfileLink[]>(() => loadLinks(name))
  const [section, setSection] = useState<LinksSection>(() => loadSection(name))
  const [header, setHeader] = useState<ProfileHeaderDraft>(() => loadHeader(name))
  const [selectedId, setSelectedId] = useState<string | null>(links[0]?.id ?? null)
  const [sectionOpen, setSectionOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [loaded, setLoaded] = useState(false)
  const lastKey = useRef<string | null>(null)
  const dirty = useRef(false)

  const selected = links.find((link) => link.id === selectedId) ?? null
  const atLimit = links.length >= MAX_LINKS

  useEffect(() => {
    let live = true
    dirty.current = false
    profilesApi.getByUsername(name).then(
      (doc) => {
        if (!live) return
        // The user may have typed before the doc arrived: their edits win
        // and the autosave below persists them.
        if (dirty.current) {
          lastKey.current = null
          setLoaded(true)
          return
        }
        const nextLinks = dtoToLinks(doc.links)
        const nextSection = dtoToSection(doc.section)
        const nextHeader = dtoToHeader(doc.header)
        lastKey.current = docKey(nextLinks, nextSection, nextHeader)
        setLinks(nextLinks)
        setSection(nextSection)
        setHeader(nextHeader)
        setSelectedId(nextLinks[0]?.id ?? null)
        saveLinks(name, nextLinks)
        saveSection(name, nextSection)
        saveHeader(name, nextHeader)
        setLoaded(true)
      },
      (error) => {
        if (!live) return
        lastKey.current = docKey(loadLinks(name), loadSection(name), loadHeader(name))
        if (errorStatus(error) == null) setSaveState('offline')
        setLoaded(true)
      },
    )
    return () => {
      live = false
    }
  }, [name])

  useEffect(() => {
    if (!loaded) return
    const key = docKey(links, section, header)
    if (key === lastKey.current) return
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      profilesApi.saveMine(docToSave(links, section, header)).then(
        () => {
          lastKey.current = key
          saveLinks(name, links)
          saveSection(name, section)
          saveHeader(name, header)
          setSaveState('saved')
        },
        (error) => {
          saveLinks(name, links)
          saveSection(name, section)
          saveHeader(name, header)
          setSaveState(errorStatus(error) == null ? 'offline' : 'error')
        },
      )
    }, 700)
    return () => window.clearTimeout(timer)
  }, [links, section, header, loaded, selectedId, name])

  const onLinksChange = (next: ProfileLink[]) => {
    dirty.current = true
    setLinks(next)
    saveLinks(name, next)
  }

  const onSectionChange = (next: LinksSection) => {
    dirty.current = true
    setSection(next)
    saveSection(name, next)
  }

  const onHeaderChange = (next: ProfileHeaderDraft) => {
    dirty.current = true
    setHeader(next)
    saveHeader(name, next)
  }

  const clearDeletedIcon = (id: number) => {
    const value = `${MEDIA_ICON_PREFIX}${id}`
    if (!links.some((link) => link.icon === value)) return
    onLinksChange(links.map((link) => (link.icon === value ? { ...link, icon: '' } : link)))
  }

  const updateLink = (id: string, patch: Partial<ProfileLink>) =>
    onLinksChange(links.map((link) => (link.id === id ? { ...link, ...patch } : link)))

  const removeLink = (id: string) => {
    setSelectedId(selectionAfterRemove(links, id))
    onLinksChange(links.filter((link) => link.id !== id))
  }

  const moveLinkBy = (id: string, dir: -1 | 1) => {
    const next = moveLink(
      links,
      links.findIndex((link) => link.id === id),
      dir,
    )
    if (next !== links) onLinksChange(next)
  }

  const addLink = () => {
    if (atLimit) return
    const fresh = blankLink()
    setSelectedId(fresh.id)
    onLinksChange([...links, fresh])
  }

  return (
    <div class="pedit-page">
      <div class="pedit-col">
        <TopBar name={name}>
          <span
            class={
              saveState === 'offline'
                ? 'pedit-saved is-warn'
                : saveState === 'error'
                  ? 'pedit-saved is-error'
                  : 'pedit-saved'
            }
            aria-live="polite"
          >
            {saveState === 'saved' && (
              <>
                <Icon d={icons.check} size={13} />
                <span>Saved</span>
              </>
            )}
            {saveState === 'saving' && <span>Saving…</span>}
            {saveState === 'offline' && <span>Offline — local only</span>}
            {saveState === 'error' && <span>Save failed</span>}
          </span>
        </TopBar>

        {!loaded && !hasLocalDoc(name) ? (
          <p class="pedit-muted">Loading links…</p>
        ) : (
        <div class="pedit-grid">
          <section class="pedit-editor" aria-label="Link editor">
            <UsernameCard username={user.username ?? name} onRename={onRename} />
            <AvatarCard
              avatarId={header.avatar}
              displayName={header.displayName || user.username || name}
              onChange={(avatar) => onHeaderChange({ ...header, avatar })}
            />
            <ProfileHeaderCard value={header} onChange={onHeaderChange} />
            <SectionSummary
              section={section}
              count={links.length}
              onEdit={() => setSectionOpen(true)}
            />
            {selected && (
              <LinkCard
                link={selected}
                index={links.indexOf(selected)}
                total={links.length}
                onUpdate={(patch) => updateLink(selected.id, patch)}
                onRemove={() => removeLink(selected.id)}
                onMove={(dir) => moveLinkBy(selected.id, dir)}
                onDeleteIcon={clearDeletedIcon}
              />
            )}
          </section>

          <aside class="pedit-preview" aria-label="Live preview">
            <p class="pedit-preview-title">Preview · @{name}</p>
            <div class="pedit-preview-card">
              <ProfileLinks
                links={links}
                section={section}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAdd={addLink}
                addDisabled={atLimit}
              />
            </div>
          </aside>
        </div>
        )}
      </div>

      {sectionOpen && (
        <Modal onClose={() => setSectionOpen(false)} labelledBy="pmodal-section-title">
          <div class="pmodal-header">
            <h2 id="pmodal-section-title">Section settings</h2>
            <button
              type="button"
              class="pmodal-close"
              onClick={() => setSectionOpen(false)}
              aria-label="Close dialog"
            >
              <Icon d={icons.close} size={18} />
            </button>
          </div>
          <div class="pmodal-body">
            <SectionEditor section={section} onChange={onSectionChange} />
          </div>
          <div class="pmodal-actions">
            <button type="button" class="pedit-btn primary" onClick={() => setSectionOpen(false)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

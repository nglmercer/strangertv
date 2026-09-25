import { useState } from 'preact/hooks'
import { route } from 'preact-router'
import { Icon, icons } from '../components/icons'
import { Modal } from '../components/Modal'
import { LinkCard } from '../components/profile/LinkEditor'
import { ProfileLinks } from '../components/profile/ProfileLinks'
import { SectionEditor, SectionSummary } from '../components/profile/SectionEditor'
import {
  MAX_LINKS,
  blankLink,
  loadLinks,
  loadSection,
  moveLink,
  saveLinks,
  saveSection,
  selectionAfterRemove,
} from '../components/profile/linksStore'
import type { LinksSection } from '../components/profile/linksStore'
import { identity, type ProfileLink } from './profileMock'

type ProfileEditPageProps = {
  path?: string
  handle?: string
}

/**
 * Link editor page. Left column: section summary (settings in a modal)
 * and one edit card for the selected link. Right column is the shared
 * section component the public profile renders, doubling as the link
 * selector with a header add button. Changes auto-save per-handle to
 * localStorage.
 */
export function ProfileEditPage({ handle }: ProfileEditPageProps) {
  const { name } = identity(handle)
  const [links, setLinks] = useState<ProfileLink[]>(() => loadLinks(name))
  const [section, setSection] = useState<LinksSection>(() => loadSection(name))
  const [selectedId, setSelectedId] = useState<string | null>(links[0]?.id ?? null)
  const [sectionOpen, setSectionOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  const selected = links.find((link) => link.id === selectedId) ?? null
  const atLimit = links.length >= MAX_LINKS

  const onLinksChange = (next: ProfileLink[]) => {
    setLinks(next)
    saveLinks(name, next)
    setSaved(true)
  }

  const onSectionChange = (next: LinksSection) => {
    setSection(next)
    saveSection(name, next)
    setSaved(true)
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
        <header class="pedit-top">
          <button type="button" class="pedit-back" onClick={() => route(`/u/${name}`, true)}>
            <Icon d={icons.arrowLeft} size={18} />
            <span>Back to profile</span>
          </button>
          <h1 class="pedit-title">Edit links</h1>
          <span class="pedit-saved" aria-live="polite">
            {saved && (
              <>
                <Icon d={icons.check} size={13} />
                <span>Saved</span>
              </>
            )}
          </span>
        </header>

        <div class="pedit-grid">
          <section class="pedit-editor" aria-label="Link editor">
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

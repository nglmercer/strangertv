import { Modal } from './Modal'
import type { Messages } from '../i18n'
import { PAGE_ID } from '../../shared/constants'

export type PageId = (typeof PAGE_ID)[keyof typeof PAGE_ID] | null

export function StaticPage({ page, t, onClose }: { page: PageId; t: Messages; onClose: () => void }) {
  if (!page) return null
  const titles: Record<Exclude<PageId, null>, string> = {
    [PAGE_ID.rules]: t.rules,
    [PAGE_ID.safety]: t.safety,
    [PAGE_ID.privacy]: t.privacy,
    [PAGE_ID.terms]: t.terms,
  }

  return (
    <Modal onClose={onClose} labelledBy="static-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="static-title">{titles[page]}</h2>
      <pre class="legal-body">{t.pages[page]}</pre>
    </Modal>
  )
}

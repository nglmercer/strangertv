import { Modal } from './Modal'
import type { Messages } from '../i18n'

export type PageId = 'rules' | 'safety' | 'privacy' | 'terms' | null

export function StaticPage({ page, t, onClose }: { page: PageId; t: Messages; onClose: () => void }) {
  if (!page) return null
  const titles: Record<Exclude<PageId, null>, string> = {
    rules: t.rules,
    safety: t.safety,
    privacy: t.privacy,
    terms: t.terms,
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

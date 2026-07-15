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
  const body: Record<Exclude<PageId, null>, string> = {
    rules: `• 18+ only. No minors.
• Keep your face visible on camera.
• No harassment, hate, threats, or illegal activity.
• No explicit sexual content without mutual consent of adults; respect local law.
• No spam, scams, or advertising.
• Report violations; abusers are banned.`,
    safety: `• Never share personal info, address, or financial data.
• You can leave or press Next at any time.
• Use Report if someone breaks the rules.
• Video and audio are not recorded by this service by default.
• If you feel unsafe, stop the chat and contact local authorities if needed.`,
    privacy: `We store account email and password hashes if you register, session tokens, optional preferences, blocks, and reports.
We do not record or store video/audio streams by default.
Matchmaking state is ephemeral in memory.
You may delete your account from settings.
Contact the operator for data requests.`,
    terms: `This is an experimental stranger video chat.
You must be 18 or older.
You are responsible for your behavior and local laws.
Service is provided as-is without warranty.
We may suspend accounts that violate the rules.
Conversations are not private from your peer; treat strangers carefully.`,
  }

  return (
    <Modal onClose={onClose} labelledBy="static-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="static-title">{titles[page]}</h2>
      <pre class="legal-body">{body[page]}</pre>
    </Modal>
  )
}

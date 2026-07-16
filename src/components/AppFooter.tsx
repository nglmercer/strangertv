import type { Messages } from '../i18n'
import type { PageId } from './StaticPages'
import { PAGE_ID } from '../../shared/constants'

export function AppFooter({
  t,
  userEmail,
  appVersion,
  onOpenPage,
}: {
  t: Messages
  userEmail: string | null
  appVersion: string
  onOpenPage: (p: PageId) => void
}) {
  return (
    <footer class="footer">
      <span>
        {t.footerAge}
        {' · '}
        <button type="button" class="linkish" onClick={() => onOpenPage(PAGE_ID.privacy)}>
          {t.privacy}
        </button>
        {' · '}
        <button type="button" class="linkish" onClick={() => onOpenPage(PAGE_ID.terms)}>
          {t.terms}
        </button>
        {appVersion ? ` · ${t.version}${appVersion}` : ''}
      </span>
      <span>{userEmail ? `${t.signedInAs} ${userEmail}` : t.notRecorded}</span>
    </footer>
  )
}

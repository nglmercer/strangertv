import type { Locale } from '../../../shared/types'
import { LOCALES } from '../../../shared/constants'
import { setStoredLocale } from '../../utils/storage'
import type { Messages } from '../../i18n'
import { Select } from '../Select'

export function LocalePrefsTab({
  t,
  locale,
  setLocale,
}: {
  t: Messages
  locale: Locale
  setLocale: (l: Locale) => void
}) {
  return (
    <div class="prefs-tab-panel" role="tabpanel">
      <label>
        {t.language}
        <Select
          t={t}
          label={t.language}
          value={locale}
          options={LOCALES.map((l) => ({ value: l, label: l === 'en' ? t.localeEn : l === 'es' ? t.localeEs : t.localePt }))}
          onChange={(next: string) => {
            const l = next as Locale
            setLocale(l)
            setStoredLocale(l)
          }}
        />
      </label>
    </div>
  )
}

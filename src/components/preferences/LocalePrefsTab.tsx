import type { Locale } from '../../../shared/types'
import { LOCALES, STORAGE_KEYS } from '../../../shared/constants'
import type { Messages } from '../../i18n'

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
        <select
          value={locale}
          onChange={(e) => {
            const l = e.currentTarget.value as Locale
            setLocale(l)
            localStorage.setItem(STORAGE_KEYS.locale, l)
          }}
        >
          {LOCALES.map((l) => (
            <option value={l} key={l}>
              {l === 'en' ? t.localeEn : l === 'es' ? t.localeEs : t.localePt}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

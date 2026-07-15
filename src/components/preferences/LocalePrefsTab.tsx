import type { Locale } from '../../../shared/types'
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
            localStorage.setItem('stranger-locale', l)
          }}
        >
          <option value="en">{t.localeEn}</option>
          <option value="es">{t.localeEs}</option>
          <option value="pt">{t.localePt}</option>
        </select>
      </label>
    </div>
  )
}

import type { Locale } from '../../shared/types'
import { en, type Messages } from './en'
import { es } from './es'
import { pt } from './pt'

const catalog: Record<Locale, Messages> = { en, es, pt }

export function t(locale: Locale): Messages {
  return catalog[locale] ?? en
}

export function detectLocale(): Locale {
  const stored = localStorage.getItem('stranger-locale')
  if (stored === 'en' || stored === 'es' || stored === 'pt') return stored
  const nav = navigator.language.slice(0, 2)
  if (nav === 'es' || nav === 'pt') return nav
  return 'en'
}

/** Replace `{key}` placeholders in a message template. */
export function formatMessage(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
}

export type { Messages }

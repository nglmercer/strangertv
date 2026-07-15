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

export function countryLabel(messages: Messages, code: string): string {
  return (messages.countries as Record<string, string>)[code] ?? code
}

export function matchLangLabel(messages: Messages, code: string): string {
  return (messages.matchLangs as Record<string, string>)[code] ?? code
}

export function interestLabel(messages: Messages, tag: string): string {
  return (messages.interestLabels as Record<string, string>)[tag] ?? tag
}

const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const

export type MonthKey = (typeof MONTH_KEYS)[number]

export function monthKeys(): readonly MonthKey[] {
  return MONTH_KEYS
}

export function monthLabel(messages: Messages, key: MonthKey): string {
  return messages.months[key]
}

/** 1-based month index from a month key. */
export function monthIndex(key: MonthKey): number {
  return MONTH_KEYS.indexOf(key) + 1
}

export type { Messages }

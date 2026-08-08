/**
 * Age-gate logic shared by server (auth) and client (wizard).
 * Pure, DOM-free, and UTC-stable so server and browser agree.
 */

export const MIN_ADULT_AGE = 18

/** How many birth years to offer in age-gate pickers (from max adult year backward). */
export const ADULT_BIRTH_YEAR_SPAN = 100

export function isAdult(birthDate: string): boolean {
  const date = new Date(`${birthDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  const today = new Date()
  let age = today.getUTCFullYear() - date.getUTCFullYear()
  const beforeBirthday =
    today.getUTCMonth() < date.getUTCMonth() ||
    (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())
  if (beforeBirthday) age--
  return date <= today && age >= MIN_ADULT_AGE
}

/**
 * Latest calendar year someone can be born and still possibly be 18+.
 * Example: in 2026 this is 2008 (2026 - 18).
 */
export function maxAdultBirthYear(now: Date = new Date()): number {
  return now.getFullYear() - MIN_ADULT_AGE
}

/** Earliest year offered in year pickers. */
export function minAdultBirthYear(
  now: Date = new Date(),
  span: number = ADULT_BIRTH_YEAR_SPAN,
): number {
  return maxAdultBirthYear(now) - span + 1
}

/**
 * Birth years newest → oldest for age-gate selects.
 * Only includes years where the person can be at least 18 (month/day still validated).
 */
export function adultBirthYears(
  now: Date = new Date(),
  span: number = ADULT_BIRTH_YEAR_SPAN,
): number[] {
  const max = maxAdultBirthYear(now)
  const min = max - span + 1
  const years: number[] = []
  for (let y = max; y >= min; y--) years.push(y)
  return years
}

/**
 * Latest ISO date (YYYY-MM-DD) that is still 18+ today.
 * Used as `max` on native date inputs.
 */
export function maxAdultBirthDate(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setFullYear(d.getFullYear() - MIN_ADULT_AGE)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Days in a calendar month (1–12). Year matters for leap days. */
export function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31
  return new Date(year, month, 0).getDate()
}

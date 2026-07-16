/**
 * Age-gate logic shared by server (auth) and client (wizard).
 * Pure, DOM-free, and UTC-stable so server and browser agree.
 */
export function isAdult(birthDate: string): boolean {
  const date = new Date(`${birthDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  const today = new Date()
  let age = today.getUTCFullYear() - date.getUTCFullYear()
  const beforeBirthday =
    today.getUTCMonth() < date.getUTCMonth() ||
    (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())
  if (beforeBirthday) age--
  return date <= today && age >= 18
}

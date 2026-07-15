export function isAdult(birthDate: string) {
  const date = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return false
  const now = new Date()
  let age = now.getFullYear() - date.getFullYear()
  if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) {
    age--
  }
  return date <= now && age >= 18
}

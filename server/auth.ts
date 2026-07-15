import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { db } from './db'

const scrypt = promisify(scryptCallback)
const SESSION_DAYS = 14

export type UserRow = {
  id: number
  email: string
  birth_date: string | null
  gender: string | null
  country: string | null
  language: string | null
  interests: string | null
}

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString('hex')
  const key = (await scrypt(password, salt, 64)) as Buffer
  return `${salt}:${key.toString('hex')}`
}

export const verifyPassword = async (password: string, stored: string) => {
  const [salt, key] = stored.split(':')
  if (!salt || !key) return false
  const derived = (await scrypt(password, salt, 64)) as Buffer
  const expected = Buffer.from(key, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const validCredentials = (email: unknown, password: unknown): email is string =>
  typeof email === 'string' &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
  typeof password === 'string' &&
  password.length >= 8

export const isAdult = (birthDate: string) => {
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

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  await db.execute({
    sql: 'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    args: [userId, hashToken(token), expires],
  })
  return token
}

export async function revokeSession(token: string) {
  await db.execute({
    sql: 'UPDATE sessions SET revoked = 1 WHERE token_hash = ?',
    args: [hashToken(token)],
  })
}

export async function userFromToken(token: string | undefined | null): Promise<UserRow | null> {
  if (!token) return null
  const result = await db.execute({
    sql: `
      SELECT u.id, u.email, u.birth_date, u.gender, u.country, u.language, u.interests
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > datetime('now')
    `,
    args: [hashToken(token)],
  })
  const row = result.rows[0]
  if (!row) return null
  return {
    id: Number(row.id),
    email: String(row.email),
    birth_date: typeof row.birth_date === 'string' ? row.birth_date : null,
    gender: typeof row.gender === 'string' ? row.gender : null,
    country: typeof row.country === 'string' ? row.country : null,
    language: typeof row.language === 'string' ? row.language : null,
    interests: typeof row.interests === 'string' ? row.interests : null,
  }
}

export async function isBanned(userId?: number | null, ip?: string | null): Promise<boolean> {
  if (userId) {
    const r = await db.execute({
      sql: `SELECT id FROM bans WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1`,
      args: [userId],
    })
    if (r.rows[0]) return true
  }
  if (ip) {
    const r = await db.execute({
      sql: `SELECT id FROM bans WHERE ip = ? AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1`,
      args: [ip],
    })
    if (r.rows[0]) return true
  }
  return false
}

export function publicUser(u: UserRow) {
  let interests: string[] = []
  try {
    interests = u.interests ? (JSON.parse(u.interests) as string[]) : []
  } catch {
    interests = []
  }
  return {
    id: u.id,
    email: u.email,
    birthDate: u.birth_date,
    gender: u.gender ?? 'other',
    country: u.country ?? 'any',
    language: u.language ?? 'en',
    interests,
  }
}

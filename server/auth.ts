import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { db } from './db'
import { DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE } from '../shared/constants'
import { parseInterests } from '../shared/json'
import { isAdult } from '../shared/age'

export { isAdult }

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
  email_verified?: number | null
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

/** Issue a new session token and revoke the previous one (sliding sessions). */
export async function refreshSession(token: string): Promise<string | null> {
  const user = await userFromToken(token)
  if (!user) return null
  await revokeSession(token)
  return createSession(user.id)
}

export async function userFromToken(token: string | undefined | null): Promise<UserRow | null> {
  if (!token) return null
  const result = await db.execute({
    sql: `
      SELECT u.id, u.email, u.birth_date, u.gender, u.country, u.language, u.interests, u.email_verified
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
    email_verified: typeof row.email_verified === 'number' ? row.email_verified : Number(row.email_verified ?? 0),
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
  const interests = parseInterests(u.interests)
  return {
    id: u.id,
    email: u.email,
    birthDate: u.birth_date,
    gender: u.gender ?? DEFAULT_GENDER,
    country: u.country ?? DEFAULT_COUNTRY,
    language: u.language ?? DEFAULT_LANGUAGE,
    interests,
    emailVerified: Boolean(u.email_verified),
  }
}

export async function createEmailVerificationToken(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + 48 * 3600_000).toISOString()
  await db.execute({
    sql: 'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    args: [userId, hashToken(token), expires],
  })
  return token
}

export async function verifyEmailToken(token: string): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT id, user_id FROM email_verification_tokens
          WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')`,
    args: [hashToken(token)],
  })
  const row = result.rows[0]
  if (!row) return false
  await db.execute({
    sql: 'UPDATE users SET email_verified = 1 WHERE id = ?',
    args: [Number(row.user_id)],
  })
  await db.execute({
    sql: 'UPDATE email_verification_tokens SET used = 1 WHERE id = ?',
    args: [Number(row.id)],
  })
  return true
}

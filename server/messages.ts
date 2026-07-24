import { db as defaultDb } from './db'
import type { Client } from '@libsql/client'

export const MAX_MESSAGE_LENGTH = 500

export async function areFriends(userId: number, otherId: number, db: Client = defaultDb): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT 1 FROM friends
          WHERE (user_a_id = ? AND user_b_id = ? OR user_a_id = ? AND user_b_id = ?)
            AND status = 'accepted'`,
    args: [userId, otherId, otherId, userId],
  })
  return result.rows.length > 0
}

export async function sendMessage(senderId: number, recipientId: number, text: string, db: Client = defaultDb) {
  if (senderId === recipientId) {
    throw new Error('Cannot send message to yourself')
  }
  if (!(await areFriends(senderId, recipientId, db))) {
    throw new Error('Not friends')
  }
  const trimmed = text.slice(0, MAX_MESSAGE_LENGTH)
  const result = await db.execute({
    sql: 'INSERT INTO messages (sender_id, recipient_id, text) VALUES (?, ?, ?)',
    args: [senderId, recipientId, trimmed],
  })
  const id = Number(result.lastInsertRowid)
  const row = await db.execute({
    sql: 'SELECT id, sender_id, recipient_id, text, created_at FROM messages WHERE id = ?',
    args: [id],
  })
  const r = row.rows[0] as any
  return {
    id: Number(r.id),
    senderId: Number(r.sender_id),
    recipientId: Number(r.recipient_id),
    text: r.text,
    createdAt: r.created_at,
  }
}

export async function getConversation(
  userId: number,
  friendId: number,
  limit = 50,
  beforeId?: number,
  db: Client = defaultDb,
) {
  const args: (number | string)[] = [userId, friendId, friendId, userId]
  let beforeClause = ''
  if (beforeId) {
    beforeClause = `AND m.id < ?`
    args.push(beforeId)
  }
  args.push(limit)
  const result = await db.execute({
    sql: `SELECT m.id, m.sender_id, m.recipient_id, m.text, m.created_at
          FROM messages m
          WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
            ${beforeClause}
          ORDER BY m.id DESC
          LIMIT ?`,
    args,
  })
  return result.rows.map((r: any) => ({
    id: Number(r.id),
    senderId: Number(r.sender_id),
    recipientId: Number(r.recipient_id),
    text: r.text,
    createdAt: r.created_at,
  })).reverse()
}

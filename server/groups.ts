import { db as defaultDb } from './db'
import type { Client } from '@libsql/client'
import type { PublicUser, Group, GroupMember, GroupMessage, GroupRole } from '../shared/types'

function publicUserFromRow(row: any, prefix: string): PublicUser {
  return {
    id: Number(row[`${prefix}id`]),
    email: row[`${prefix}email`] ?? '',
    birthDate: row[`${prefix}birth_date`] ?? undefined,
    gender: row[`${prefix}gender`] ?? undefined,
    country: row[`${prefix}country`] ?? undefined,
    language: row[`${prefix}language`] ?? undefined,
    interests: row[`${prefix}interests`] ? JSON.parse(row[`${prefix}interests`]) : undefined,
    emailVerified: row[`${prefix}email_verified`] != null ? Boolean(row[`${prefix}email_verified`]) : undefined,
  }
}

export async function getGroups(userId: number, db: Client = defaultDb) {
  const result = await db.execute({
    sql: `SELECT g.id, g.name, g.created_by, g.created_at,
                 gm.role AS my_role,
                 (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
          FROM groups g
          JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
          ORDER BY g.created_at DESC`,
    args: [userId],
  })
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    name: row.name,
    createdBy: Number(row.created_by),
    createdAt: row.created_at,
    myRole: row.my_role,
    memberCount: Number(row.member_count),
  } as Group))
}

export async function getGroup(groupId: number, userId: number, db: Client = defaultDb) {
  const result = await db.execute({
    sql: `SELECT g.id, g.name, g.created_by, g.created_at,
                 gm.role AS my_role,
                 (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
          FROM groups g
          JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
          WHERE g.id = ?`,
    args: [userId, groupId],
  })
  if (result.rows.length === 0) return null
  const row = result.rows[0] as any
  return {
    id: Number(row.id),
    name: row.name,
    createdBy: Number(row.created_by),
    createdAt: row.created_at,
    myRole: row.my_role,
    memberCount: Number(row.member_count),
  } as Group
}

export async function getGroupMembers(groupId: number, db: Client = defaultDb) {
  const result = await db.execute({
    sql: `SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.joined_at,
                 u.id AS user_id, u.email AS user_email, u.birth_date AS user_birth_date,
                 u.gender AS user_gender, u.country AS user_country,
                 u.language AS user_language, u.interests AS user_interests,
                 u.email_verified AS user_email_verified
          FROM group_members gm
          JOIN users u ON u.id = gm.user_id
          WHERE gm.group_id = ?
          ORDER BY gm.joined_at ASC`,
    args: [groupId],
  })
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    groupId: Number(row.group_id),
    userId: Number(row.user_id),
    role: row.role,
    joinedAt: row.joined_at,
    user: publicUserFromRow(row, 'user_'),
  })) as GroupMember[]
}

export async function createGroup(creatorId: number, name: string, memberIds: number[], db: Client = defaultDb) {
  const trimmed = name.trim().slice(0, 100)
  if (!trimmed) throw new Error('Group name is required')
  const result = await db.execute({
    sql: 'INSERT INTO groups (name, created_by) VALUES (?, ?)',
    args: [trimmed, creatorId],
  })
  const groupId = Number(result.lastInsertRowid)
  await db.execute({
    sql: "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')",
    args: [groupId, creatorId],
  })
  for (const memberId of memberIds) {
    if (memberId === creatorId) continue
    await db.execute({
      sql: "INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
      args: [groupId, memberId],
    })
  }
  const group = await getGroup(groupId, creatorId, db)
  const members = await getGroupMembers(groupId, db)
  return { group, members }
}

export async function renameGroup(groupId: number, userId: number, newName: string, db: Client = defaultDb) {
  const group = await getGroup(groupId, userId, db)
  if (!group) throw new Error('Group not found')
  if (group.myRole !== 'admin') throw new Error('Only admin can rename the group')
  const trimmed = newName.trim().slice(0, 100)
  if (!trimmed) throw new Error('Group name is required')
  await db.execute({
    sql: 'UPDATE groups SET name = ? WHERE id = ?',
    args: [trimmed, groupId],
  })
  return { ok: true }
}

export async function addGroupMembers(groupId: number, userId: number, newMemberIds: number[], db: Client = defaultDb) {
  const group = await getGroup(groupId, userId, db)
  if (!group) throw new Error('Group not found')
  if (group.myRole !== 'admin') throw new Error('Only admin can add members')
  for (const memberId of newMemberIds) {
    if (memberId === userId) continue
    await db.execute({
      sql: "INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
      args: [groupId, memberId],
    })
  }
  return { ok: true }
}

export async function removeGroupMember(groupId: number, userId: number, targetUserId: number, db: Client = defaultDb) {
  const group = await getGroup(groupId, userId, db)
  if (!group) throw new Error('Group not found')
  if (userId === targetUserId) {
    if (group.myRole === 'admin') {
      const members = await getGroupMembers(groupId, db)
      const otherAdmins = members.filter((m) => m.role === 'admin' && m.userId !== userId)
      if (otherAdmins.length === 0) throw new Error('Cannot leave group with no other admins')
    }
    await db.execute({
      sql: 'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      args: [groupId, userId],
    })
    return { left: true }
  }
  if (group.myRole !== 'admin') throw new Error('Only admin can remove members')
  await db.execute({
    sql: 'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
    args: [groupId, targetUserId],
  })
  return { removed: true }
}

export async function leaveGroup(groupId: number, userId: number, db: Client = defaultDb) {
  const group = await getGroup(groupId, userId, db)
  if (!group) throw new Error('Group not found')
  if (group.myRole === 'admin') {
    const members = await getGroupMembers(groupId, db)
    const otherAdmins = members.filter((m) => m.role === 'admin' && m.userId !== userId)
    if (otherAdmins.length === 0) throw new Error('Cannot leave group with no other admins')
  }
  await db.execute({
    sql: 'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
    args: [groupId, userId],
  })
  return { left: true }
}

export async function sendGroupMessage(groupId: number, senderId: number, text: string, db: Client = defaultDb) {
  const member = await db.execute({
    sql: 'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
    args: [groupId, senderId],
  })
  if (member.rows.length === 0) throw new Error('Not a group member')
  const trimmed = text.slice(0, 500)
  const result = await db.execute({
    sql: 'INSERT INTO group_messages (group_id, sender_id, text) VALUES (?, ?, ?)',
    args: [groupId, senderId, trimmed],
  })
  const id = Number(result.lastInsertRowid)
  const row = await db.execute({
    sql: 'SELECT id, group_id, sender_id, text, created_at FROM group_messages WHERE id = ?',
    args: [id],
  })
  const r = row.rows[0] as any
  return {
    id: Number(r.id),
    groupId: Number(r.group_id),
    senderId: Number(r.sender_id),
    text: r.text,
    createdAt: r.created_at,
  }
}

export async function getGroupMessages(groupId: number, userId: number, limit = 50, beforeId?: number, db: Client = defaultDb) {
  const member = await db.execute({
    sql: 'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
    args: [groupId, userId],
  })
  if (member.rows.length === 0) throw new Error('Not a group member')
  const args: (number | string)[] = [groupId]
  let beforeClause = ''
  if (beforeId) {
    beforeClause = 'AND gm.id < ?'
    args.push(beforeId)
  }
  args.push(limit)
  const result = await db.execute({
    sql: `SELECT gm.id, gm.group_id, gm.sender_id, gm.text, gm.created_at,
                 u.id AS sender_id_col, u.email AS sender_email,
                 u.birth_date AS sender_birth_date, u.gender AS sender_gender,
                 u.country AS sender_country, u.language AS sender_language,
                 u.interests AS sender_interests, u.email_verified AS sender_email_verified
          FROM group_messages gm
          JOIN users u ON u.id = gm.sender_id
          WHERE gm.group_id = ? ${beforeClause}
          ORDER BY gm.id DESC
          LIMIT ?`,
    args,
  })
  return result.rows.map((r: any) => ({
    id: Number(r.id),
    groupId: Number(r.group_id),
    senderId: Number(r.sender_id),
    text: r.text,
    createdAt: r.created_at,
    sender: publicUserFromRow(r, 'sender_'),
  })).reverse() as GroupMessage[]
}

export async function isGroupMember(groupId: number, userId: number, db: Client = defaultDb) {
  const result = await db.execute({
    sql: 'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
    args: [groupId, userId],
  })
  return result.rows.length > 0
}
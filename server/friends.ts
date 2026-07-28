import { db } from './db'
import type { Gender, PublicUser } from '../shared/types'
import { API_ROUTES } from '../shared/constants'

type DbRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

export async function getFriends(userId: number) {
  const result = await db.execute({
    sql: `SELECT f.id, f.user_a_id AS userAId, f.user_b_id AS userBId, f.status,
                 f.created_at AS createdAt, f.updated_at AS updatedAt,
                 u.id AS other_id, u.email AS other_email, u.birth_date AS other_birth_date,
                 u.gender AS other_gender, u.country AS other_country,
                 u.language AS other_language, u.interests AS other_interests,
                 u.email_verified AS other_email_verified
          FROM friends f
          JOIN users u ON u.id = CASE
            WHEN f.user_a_id = ? THEN f.user_b_id
            WHEN f.user_b_id = ? THEN f.user_a_id
          END
          WHERE (f.user_a_id = ? OR f.user_b_id = ?)
          ORDER BY f.updated_at DESC`,
    args: [userId, userId, userId, userId],
  })
  return result.rows.map((row) => ({
    id: Number(row.id),
    userAId: Number(row.userAId),
    userBId: Number(row.userBId),
    status: row.status as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    otherUser: publicUserFromRow(row as DbRow, 'other_'),
  }))
}

export async function getPendingFriendRequests(userId: number) {
  const result = await db.execute({
    sql: `SELECT f.id, f.user_a_id AS requesterId, f.status, f.created_at AS createdAt,
                 u.id AS requester_id, u.email AS requester_email, u.birth_date AS requester_birth_date,
                 u.gender AS requester_gender, u.country AS requester_country,
                 u.language AS requester_language, u.interests AS requester_interests,
                 u.email_verified AS requester_email_verified
          FROM friends f
          JOIN users u ON u.id = f.user_a_id
           WHERE f.user_b_id = ? AND f.status = 'pending'
           ORDER BY f.created_at DESC`,
    args: [userId],
  })
  return result.rows.map((row) => ({
    id: Number(row.id),
    requesterId: Number(row.requesterId),
    status: row.status as string,
    createdAt: row.createdAt as string,
    requester: publicUserFromRow(row as DbRow, 'requester_'),
  }))
}

export async function sendFriendRequest(userId: number, targetUserId: number) {
  if (userId === targetUserId) {
    throw new Error('Cannot send friend request to yourself')
  }
  // user_a = requester, user_b = recipient (accept/decline require user_b)
  const existing = await db.execute({
    sql: `SELECT id, status, user_a_id, user_b_id FROM friends
          WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)`,
    args: [userId, targetUserId, targetUserId, userId],
  })
  const row = existing.rows[0]
  if (row) {
    if (row.status === 'accepted') return { ok: true }
    if (row.status === 'pending') return { ok: true }
    // re-request after decline: set requester as user_a
    await db.execute({
      sql: `UPDATE friends SET user_a_id = ?, user_b_id = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [userId, targetUserId, row.id],
    })
    return { ok: true }
  }
  await db.execute({
    sql: "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (?, ?, 'pending')",
    args: [userId, targetUserId],
  })
  return { ok: true }
}

export async function respondFriendRequest(friendId: number, userId: number, action: 'accept' | 'decline') {
  const result = await db.execute({
    sql: "SELECT * FROM friends WHERE id = ? AND user_b_id = ? AND status = 'pending'",
    args: [friendId, userId],
  })
  if (!result.rows[0]) {
    throw new Error('Friend request not found')
  }
  const newStatus = action === 'accept' ? 'accepted' : 'declined'
  await db.execute({
    sql: 'UPDATE friends SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    args: [newStatus, friendId],
  })
  return { ok: true, status: newStatus }
}

export async function removeFriend(friendId: number, userId: number) {
  await db.execute({
    sql: 'DELETE FROM friends WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)',
    args: [friendId, userId, userId],
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

export async function followUser(followerId: number, followedId: number) {
  if (followerId === followedId) {
    throw new Error('Cannot follow yourself')
  }
  await db.execute({
    sql: 'INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)',
    args: [followerId, followedId],
  })
  return { ok: true }
}

export async function unfollowUser(followerId: number, followedId: number) {
  await db.execute({
    sql: 'DELETE FROM follows WHERE follower_id = ? AND followed_id = ?',
    args: [followerId, followedId],
  })
  return { ok: true }
}

export async function getFollows(userId: number) {
  const [followersResult, followingResult] = await Promise.all([
    db.execute({
      sql: `SELECT f.id, f.follower_id, u.id AS follower_id, u.email AS follower_email,
                   u.birth_date AS follower_birth_date, u.gender AS follower_gender,
                   u.country AS follower_country, u.language AS follower_language,
                   u.interests AS follower_interests, u.email_verified AS follower_email_verified
            FROM follows f
            JOIN users u ON u.id = f.follower_id
            WHERE f.followed_id = ?
            ORDER BY f.created_at DESC`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT f.id, f.followed_id, u.id AS followed_id, u.email AS followed_email,
                   u.birth_date AS followed_birth_date, u.gender AS followed_gender,
                   u.country AS followed_country, u.language AS followed_language,
                   u.interests AS followed_interests, u.email_verified AS followed_email_verified
            FROM follows f
            JOIN users u ON u.id = f.followed_id
            WHERE f.follower_id = ?
            ORDER BY f.created_at DESC`,
      args: [userId],
    }),
  ])

  const followers = followersResult.rows.map((row) => ({
    id: Number(row.id),
    followedId: Number(row.follower_id),
    followedUser: publicUserFromRow(row as DbRow, 'follower_'),
  }))
  const following = followingResult.rows.map((row) => ({
    id: Number(row.id),
    followedId: Number(row.followed_id),
    followedUser: publicUserFromRow(row as DbRow, 'followed_'),
  }))

  return { followers, following }
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function getInvitations(userId: number) {
  const result = await db.execute({
    sql: `SELECT i.id, i.inviter_id, i.room_id, i.status, i.created_at, i.expires_at,
                 u.id AS inviter_id_col, u.email AS inviter_email,
                 u.birth_date AS inviter_birth_date, u.gender AS inviter_gender,
                 u.country AS inviter_country, u.language AS inviter_language,
                 u.interests AS inviter_interests, u.email_verified AS inviter_email_verified
          FROM invitations i
          JOIN users u ON u.id = i.inviter_id
          WHERE i.invitee_id = ? AND i.status = 'pending' AND i.expires_at > datetime('now')
          ORDER BY i.created_at DESC`,
    args: [userId],
  })
  return result.rows.map((row) => ({
    id: Number(row.id),
    inviterId: Number(row.inviter_id),
    roomId: row.room_id as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    inviterUser: publicUserFromRow(row as DbRow, 'inviter_'),
  }))
}

export async function sendInvitation(inviterId: number, inviteeId: number, roomId: string) {
  if (inviterId === inviteeId) {
    throw new Error('Cannot invite yourself')
  }
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString() // 30 min expiry
  await db.execute({
    sql: "INSERT OR REPLACE INTO invitations (inviter_id, invitee_id, room_id, status, expires_at) VALUES (?, ?, ?, 'pending', ?)",
    args: [inviterId, inviteeId, roomId, expiresAt],
  })
  const result = await db.execute({
    sql: "SELECT id FROM invitations WHERE inviter_id = ? AND invitee_id = ? AND room_id = ? AND status = 'pending'",
    args: [inviterId, inviteeId, roomId],
  })
  const row = result.rows[0] as unknown as { id: number } | undefined
  return { ok: true, invitationId: row?.id ?? 0 }
}

export async function respondInvitation(invitationId: number, inviteeId: number, action: 'accept' | 'decline') {
  const result = await db.execute({
    sql: "SELECT * FROM invitations WHERE id = ? AND invitee_id = ?",
    args: [invitationId, inviteeId],
  })
  const row = result.rows[0]
  if (!row) {
    throw new Error('Invitation not found')
  }
  const targetStatus = action === 'accept' ? 'accepted' : 'declined'
  if (row.status === targetStatus) {
    return { ok: true, status: targetStatus }
  }
  if (row.status !== 'pending') {
    throw new Error(`Invitation already ${row.status}`)
  }
  await db.execute({
    sql: 'UPDATE invitations SET status = ? WHERE id = ?',
    args: [targetStatus, invitationId],
  })
  return { ok: true, status: targetStatus }
}

export async function cancelInvitation(invitationId: number, inviterId: number) {
  await db.execute({
    sql: 'DELETE FROM invitations WHERE id = ? AND inviter_id = ?',
    args: [invitationId, inviterId],
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function publicUserFromRow(row: DbRow, prefix: string): PublicUser {
  const interests = row[`${prefix}interests`]
  return {
    id: Number(row[`${prefix}id`]),
    email: (row[`${prefix}email`] as string) ?? '',
    birthDate: (row[`${prefix}birth_date`] as string) ?? undefined,
    gender: (row[`${prefix}gender`] as Gender) ?? undefined,
    country: (row[`${prefix}country`] as string) ?? undefined,
    language: (row[`${prefix}language`] as string) ?? undefined,
    interests: interests ? JSON.parse(interests as string) : undefined,
    emailVerified: row[`${prefix}email_verified`] != null ? Boolean(row[`${prefix}email_verified`]) : undefined,
  }
}

import { db } from './db'
import type { PublicUser } from '../shared/types'
import { API_ROUTES } from '../shared/constants'

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

export async function getFriends(userId: number) {
  const result = await db.execute({
    sql: `SELECT f.id, f.user_b_id AS otherUserId, f.status, f.updated_at AS updatedAt,
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
            AND f.status = 'accepted'
          ORDER BY f.updated_at DESC`,
    args: [userId, userId, userId, userId],
  })
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    otherUser: publicUserFromRow(row, 'other_'),
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
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    requesterId: Number(row.requesterId),
    status: row.status,
    createdAt: row.createdAt,
    requester: publicUserFromRow(row, 'requester_'),
  }))
}

export async function sendFriendRequest(userId: number, targetUserId: number) {
  if (userId === targetUserId) {
    throw new Error('Cannot send friend request to yourself')
  }
  const result = await db.execute({
    sql: 'INSERT OR IGNORE INTO friends (user_a_id, user_b_id, status) VALUES (?, ?, "pending")',
    args: [Math.min(userId, targetUserId), Math.max(userId, targetUserId)],
  })
  return { ok: true }
}

export async function respondFriendRequest(friendId: number, userId: number, action: 'accept' | 'decline') {
  const result = await db.execute({
    sql: 'SELECT * FROM friends WHERE id = ? AND user_b_id = ? AND status = "pending"',
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

  const followers = followersResult.rows.map((row: any) => ({
    id: Number(row.id),
    followedId: Number(row.follower_id),
    followedUser: publicUserFromRow(row, 'follower_'),
  }))
  const following = followingResult.rows.map((row: any) => ({
    id: Number(row.id),
    followedId: Number(row.followed_id),
    followedUser: publicUserFromRow(row, 'followed_'),
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
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    inviterId: Number(row.inviter_id),
    roomId: row.room_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    inviterUser: publicUserFromRow(row, 'inviter_'),
  }))
}

export async function sendInvitation(inviterId: number, inviteeId: number, roomId: string) {
  if (inviterId === inviteeId) {
    throw new Error('Cannot invite yourself')
  }
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString() // 30 min expiry
  await db.execute({
    sql: 'INSERT OR REPLACE INTO invitations (inviter_id, invitee_id, room_id, status, expires_at) VALUES (?, ?, ?, "pending", ?)',
    args: [inviterId, inviteeId, roomId, expiresAt],
  })
  return { ok: true }
}

export async function respondInvitation(invitationId: number, inviteeId: number, action: 'accept' | 'decline') {
  const result = await db.execute({
    sql: 'SELECT * FROM invitations WHERE id = ? AND invitee_id = ? AND status = "pending"',
    args: [invitationId, inviteeId],
  })
  if (!result.rows[0]) {
    throw new Error('Invitation not found')
  }
  const newStatus = action === 'accept' ? 'accepted' : 'declined'
  await db.execute({
    sql: 'UPDATE invitations SET status = ? WHERE id = ?',
    args: [newStatus, invitationId],
  })
  return { ok: true, status: newStatus }
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

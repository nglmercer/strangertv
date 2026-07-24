import type { Hono } from 'hono'
import { db } from '../db'
import {
  getFriends,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  followUser,
  unfollowUser,
  getFollows,
  getInvitations,
  sendInvitation,
  respondInvitation,
  cancelInvitation,
} from '../friends'
import { sendMessage, getConversation, hasRelationship } from '../messages'
import { getSocketForUser, type SocketLike } from '../matchmaking'
import { rateLimit } from '../rateLimit'
import { getBearer } from '../http'
import { userFromToken, publicUser } from '../auth'
import {
  API_ROUTES,
  HTTP_STATUS,
  WS_MESSAGE_TYPE,
} from '../../shared/constants'
import type { ServerMessage } from '../../shared/types'

export function registerSocialRoutes(app: Hono, send: (socket: SocketLike, msg: ServerMessage) => void) {
  // Friends
  app.get(API_ROUTES.friends, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const friends = await getFriends(user.id)
    return c.json({ friends })
  })

  app.post(API_ROUTES.friendsRequest, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const { userId } = await c.req.json<{ userId?: number }>()
    if (!userId || userId === user.id) return c.json({ error: 'Invalid target' }, HTTP_STATUS.badRequest)
    const target = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [userId] })
    if (!target.rows[0]) return c.json({ error: 'User not found' }, HTTP_STATUS.notFound)
    await sendFriendRequest(user.id, userId)
    const targetSocket = getSocketForUser(userId)
    if (targetSocket) {
      send(targetSocket, { type: WS_MESSAGE_TYPE.friendRequest, friendId: user.id, from: publicUser(user) })
    }
    return c.json({ ok: true })
  })

  app.patch(API_ROUTES.friendById(':id', 'accept'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const friendId = Number(c.req.param('id'))
    if (!friendId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await respondFriendRequest(friendId, user.id, 'accept')
    const friend = await db.execute({ sql: 'SELECT user_a_id, user_b_id FROM friends WHERE id = ?', args: [friendId] })
    const row = friend.rows[0]
    if (row) {
      const otherId = Number(row.user_a_id) === user.id ? Number(row.user_b_id) : Number(row.user_a_id)
      const otherSocket = getSocketForUser(otherId)
      if (otherSocket) {
        send(otherSocket, { type: WS_MESSAGE_TYPE.friendAccepted, friendId, from: publicUser(user) })
      }
    }
    return c.json({ ok: true })
  })

  app.patch(API_ROUTES.friendById(':id', 'decline'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const friendId = Number(c.req.param('id'))
    if (!friendId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await respondFriendRequest(friendId, user.id, 'decline')
    return c.json({ ok: true })
  })

  app.delete(API_ROUTES.friendById(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const friendId = Number(c.req.param('id'))
    if (!friendId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await removeFriend(friendId, user.id)
    return c.json({ ok: true })
  })

  // Messages
  app.get(API_ROUTES.messages, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const friendId = Number(c.req.query('friendId'))
    if (!friendId) return c.json({ error: 'friendId required' }, HTTP_STATUS.badRequest)
    if (!(await hasRelationship(user.id, friendId))) {
      return c.json({ error: 'No relationship' }, HTTP_STATUS.forbidden)
    }
    const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
    const beforeId = c.req.query('beforeId') ? Number(c.req.query('beforeId')) : undefined
    const messages = await getConversation(user.id, friendId, limit, beforeId)
    return c.json({ messages })
  })

  app.post(API_ROUTES.messages, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    if (!rateLimit(`msg:${user.id}`, 30, 60_000)) {
      return c.json({ error: 'Rate limit exceeded' }, HTTP_STATUS.tooManyRequests)
    }
    const { friendId, text } = await c.req.json<{ friendId?: number; text?: string }>()
    if (!friendId || !text) return c.json({ error: 'friendId and text required' }, HTTP_STATUS.badRequest)
    if (!(await hasRelationship(user.id, friendId))) {
      return c.json({ error: 'No relationship' }, HTTP_STATUS.forbidden)
    }
    const message = await sendMessage(user.id, friendId, text)
    const targetSocket = getSocketForUser(friendId)
    if (targetSocket) {
      send(targetSocket, { type: WS_MESSAGE_TYPE.messageNew, message })
    }
    return c.json({ message })
  })

  // Follows
  app.post(API_ROUTES.follows, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const { userId } = await c.req.json<{ userId?: number }>()
    if (!userId || userId === user.id) return c.json({ error: 'Invalid target' }, HTTP_STATUS.badRequest)
    const target = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [userId] })
    if (!target.rows[0]) return c.json({ error: 'User not found' }, HTTP_STATUS.notFound)
    await followUser(user.id, userId)
    const targetSocket = getSocketForUser(userId)
    if (targetSocket) {
      send(targetSocket, { type: WS_MESSAGE_TYPE.followConfirm, followed: publicUser(user) })
    }
    return c.json({ ok: true })
  })

  app.delete(API_ROUTES.followByUser(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const followedId = Number(c.req.param('id'))
    if (!followedId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await unfollowUser(user.id, followedId)
    return c.json({ ok: true })
  })

  app.get(API_ROUTES.follows, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const follows = await getFollows(user.id)
    return c.json(follows)
  })

  // Invitations
  app.get(API_ROUTES.invitations, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const invitations = await getInvitations(user.id)
    return c.json({ invitations })
  })

  app.post(API_ROUTES.invitations, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const { userId, roomId } = await c.req.json<{ userId?: number; roomId?: string }>()
    if (!userId || !roomId) return c.json({ error: 'Missing userId or roomId' }, HTTP_STATUS.badRequest)
    if (userId === user.id) return c.json({ error: 'Cannot invite yourself' }, HTTP_STATUS.badRequest)
    const target = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [userId] })
    if (!target.rows[0]) return c.json({ error: 'User not found' }, HTTP_STATUS.notFound)
    await sendInvitation(user.id, userId, roomId)
    const targetSocket = getSocketForUser(userId)
    if (targetSocket) {
      send(targetSocket, { type: WS_MESSAGE_TYPE.invitationSend, invitationId: 0, roomId, inviter: publicUser(user) })
    }
    return c.json({ ok: true })
  })

  app.patch(API_ROUTES.invitationById(':id', 'accept'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const invitationId = Number(c.req.param('id'))
    if (!invitationId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await respondInvitation(invitationId, user.id, 'accept')
    return c.json({ ok: true })
  })

  app.patch(API_ROUTES.invitationById(':id', 'decline'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const invitationId = Number(c.req.param('id'))
    if (!invitationId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await respondInvitation(invitationId, user.id, 'decline')
    return c.json({ ok: true })
  })

  app.delete(API_ROUTES.invitationById(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const invitationId = Number(c.req.param('id'))
    if (!invitationId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await cancelInvitation(invitationId, user.id)
    return c.json({ ok: true })
  })
}

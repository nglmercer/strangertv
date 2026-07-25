import type { Hono } from 'hono'
import { db } from '../db'
import {
  getGroups,
  getGroup,
  getGroupMembers,
  createGroup,
  renameGroup,
  addGroupMembers,
  removeGroupMember,
  leaveGroup,
  sendGroupMessage,
  getGroupMessages,
} from '../groups'
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

export function registerGroupsRoutes(app: Hono, send: (socket: SocketLike, msg: ServerMessage) => void) {
  app.get(API_ROUTES.groups, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groups = await getGroups(user.id)
    return c.json({ groups })
  })

  app.post(API_ROUTES.groups, async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const { name, memberIds } = await c.req.json<{ name?: string; memberIds?: number[] }>()
    if (!name || !name.trim()) return c.json({ error: 'Group name is required' }, HTTP_STATUS.badRequest)
    if (!memberIds || memberIds.length === 0) return c.json({ error: 'At least one member is required' }, HTTP_STATUS.badRequest)
    const { group } = await createGroup(user.id, name, memberIds)
    return c.json({ group }, HTTP_STATUS.created)
  })

  app.get(API_ROUTES.groupById(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    if (!groupId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    const group = await getGroup(groupId, user.id)
    if (!group) return c.json({ error: 'Group not found' }, HTTP_STATUS.notFound)
    return c.json({ group })
  })

  app.patch(API_ROUTES.groupById(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    if (!groupId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    const { name } = await c.req.json<{ name?: string }>()
    if (!name || !name.trim()) return c.json({ error: 'Group name is required' }, HTTP_STATUS.badRequest)
    await renameGroup(groupId, user.id, name)
    return c.json({ ok: true })
  })

  app.get(API_ROUTES.groupMembers(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    if (!groupId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    const members = await getGroupMembers(groupId)
    return c.json({ members })
  })

  app.post(API_ROUTES.groupMembers(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    if (!groupId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    const { userIds } = await c.req.json<{ userIds?: number[] }>()
    if (!userIds || userIds.length === 0) return c.json({ error: 'userIds required' }, HTTP_STATUS.badRequest)
    await addGroupMembers(groupId, user.id, userIds)
    const members = await getGroupMembers(groupId)
    return c.json({ members })
  })

  app.delete(API_ROUTES.groupRemoveMember(':id', ':userId'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    const targetUserId = Number(c.req.param('userId'))
    if (!groupId || !targetUserId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await removeGroupMember(groupId, user.id, targetUserId)
    return c.json({ ok: true })
  })

  app.post(API_ROUTES.groupLeave(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    if (!groupId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    await leaveGroup(groupId, user.id)
    return c.json({ ok: true })
  })

  app.get(API_ROUTES.groupMessages(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    if (!groupId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
    const beforeId = c.req.query('beforeId') ? Number(c.req.query('beforeId')) : undefined
    const messages = await getGroupMessages(groupId, user.id, limit, beforeId)
    return c.json({ messages })
  })

  app.post(API_ROUTES.groupMessages(':id'), async (c) => {
    const user = await userFromToken(getBearer(c))
    if (!user) return c.json({ error: 'Unauthorized' }, HTTP_STATUS.unauthorized)
    const groupId = Number(c.req.param('id'))
    if (!groupId) return c.json({ error: 'Invalid id' }, HTTP_STATUS.badRequest)
    if (!rateLimit(`groupmsg:${user.id}`, 30, 60_000)) {
      return c.json({ error: 'Rate limit exceeded' }, HTTP_STATUS.tooManyRequests)
    }
    const { text } = await c.req.json<{ text?: string }>()
    if (!text || !text.trim()) return c.json({ error: 'text is required' }, HTTP_STATUS.badRequest)
    const message = await sendGroupMessage(groupId, user.id, text)
    const members = await getGroupMembers(groupId)
    for (const member of members) {
      const targetSocket = getSocketForUser(member.userId)
      if (targetSocket) {
        send(targetSocket, {
          type: WS_MESSAGE_TYPE.groupMessageNew,
          message: {
            id: message.id,
            groupId: message.groupId,
            senderId: message.senderId,
            text: message.text,
            createdAt: message.createdAt,
          },
        } as ServerMessage)
      }
    }
    return c.json({ message })
  })
}
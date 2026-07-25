import type { WebSocket } from 'ws'
import { db } from '../db'
import {
  getMeta,
  getPartner,
  getPartnerUserId,
  getRoom,
  heartbeat,
  leaveRoom,
  matchUsers,
  removeFromQueue,
  send,
  blockPair,
  getSocketForUser,
  createGroupMatchRoom,
  getGroupRoom,
  getGroupRoomById,
  addParticipantToGroup,
  startGroupMatch,
  type SocketLike,
  type GroupRoom,
} from '../matchmaking'
import { userFromToken, publicUser, type UserRow } from '../auth'
import {
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  followUser,
  unfollowUser,
  sendInvitation,
  respondInvitation,
} from '../friends'
import { sendMessage, getConversation, hasRelationship } from '../messages'
import { sendGroupMessage, getGroupMembers, sendGroupInvite, respondGroupInvite, getGroupInvite } from '../groups'
import { noteReport } from '../alerts'
import { inc } from '../metrics'
import { rateLimit } from '../rateLimit'
import { config } from '../config'
import { logger } from '../logger'
import type { ClientMessage } from '../../shared/types'
import {
  METRIC_NAMES,
  PEER_LEFT_REASON,
  SERVER_ERROR_CODE,
  WS_MESSAGE_TYPE,
} from '../../shared/constants'

function asSocket(ws: WebSocket): SocketLike {
  return ws as unknown as SocketLike
}

export interface WsState {
  draining: { value: boolean }
}

export function createWsHandler(state: WsState) {
  return async function handleWsMessage(ws: WebSocket, ip: string, sessionKey: string, raw: string) {
    const socket = asSocket(ws)
    let message: ClientMessage
    try {
      message = JSON.parse(raw) as ClientMessage
    } catch {
      return
    }

    if (message.type === WS_MESSAGE_TYPE.queueHeartbeat) {
      heartbeat(socket)
      return
    }

    if (message.type === WS_MESSAGE_TYPE.queueJoin || message.type === WS_MESSAGE_TYPE.roomNext) {
      if (state.draining.value) {
        send(socket, { type: WS_MESSAGE_TYPE.serverDraining, message: 'Server is restarting. Try again shortly.' })
        return
      }
      if (!rateLimit(`wsjoin:${ip}`, 40, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down.' })
        return
      }
      if (await isBanned(null, ip)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.banned, message: 'Access denied.' })
        return
      }
      if (!config.features.anonymousMatch && !message.token) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to match.' })
        return
      }
      const prefs = normalizePreferences(message.preferences)
      if (!prefs) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Invalid preferences.' })
        return
      }
      if (prefs.mode === 'group') {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Use group-match:create to start group matching.' })
        return
      }
      let userId: number | undefined
      let userEmail: string | undefined
      if (message.token) {
        const user = await userFromToken(message.token)
        if (user) {
          if (await isBanned(user.id, ip)) {
            send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.banned, message: 'Access denied.' })
            return
          }
          if (config.features.requireEmailVerified && !user.email_verified) {
            send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.emailUnverified, message: 'Verify your email first.' })
            return
          }
          userId = user.id
          userEmail = user.email
        }
      }
      if (message.type === WS_MESSAGE_TYPE.roomNext) {
        console.debug('[ws] room:next', { userId })
        leaveRoom(socket, true, PEER_LEFT_REASON.next)
        inc(METRIC_NAMES.roomNext)
      }
      joinQueue(socket, prefs, { userId, email: userEmail, sessionKey })
      return
    }

    if (message.type === WS_MESSAGE_TYPE.queueLeave || message.type === WS_MESSAGE_TYPE.roomLeave) {
      removeFromQueue(socket)
      leaveRoom(socket, true, PEER_LEFT_REASON.leave)
      return
    }

    // Group match: create a group room
    if (message.type === 'group-match:create') {
      if (!message.token) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to create group matches.' })
        return
      }
      const user = await userFromToken(message.token)
      if (!user) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Invalid token.' })
        return
      }
      const visibility = message.visibility === 'private' ? 'private' : 'public'
      const prefs = normalizePreferences(message.preferences)
      if (!prefs) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Invalid preferences.' })
        return
      }
      const mode = prefs.mode === 'group' ? 'group' : 'solo'
      const roomId = createGroupMatchRoom(socket, visibility, { ...prefs, mode, matchScope: prefs.matchScope }, {
        userId: user.id,
        email: user.email,
        sessionKey,
      })
      return
    }

    // Group match: invite a friend to join the group
    if (message.type === 'group-match:invite') {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to invite.' })
        return
      }
      const group = getGroupRoom(socket)
      if (!group) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'No group room.' })
        return
      }
      const targetSocket = getSocketForUser(message.userId)
      if (!targetSocket) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'User is not online.' })
        return
      }
      const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
      const inviterProfile = inviterRow.rows[0]
      send(targetSocket, {
        type: 'group-match:invite-received',
        roomId: group.id,
        host: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: meta.userId, email: '' },
      })
      send(socket, { type: WS_MESSAGE_TYPE.groupMatchInviteSent, userId: message.userId })
      return
    }

    // Group match: join a group room (accepting invite)
    if (message.type === 'group-match:join') {
      if (!message.token) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to join.' })
        return
      }
      const user = await userFromToken(message.token)
      if (!user) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Invalid token.' })
        return
      }
      const group = getGroupRoomById(message.roomId)
      if (!group) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Group not found.' })
        return
      }
      const prefs = normalizePreferences(group.preferences)
      if (!prefs) return
      addParticipantToGroup(group, socket, {
        userId: user.id,
        email: user.email,
        preferences: prefs,
        sessionKey,
      })
      return
    }

    // Group match: start matching (enter queue)
    if (message.type === 'group-match:start') {
      const group = getGroupRoomById(message.roomId)
      if (!group) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Group not found.' })
        return
      }
      startGroupMatch(group)
      return
    }

    // Group match: leave group
    if (message.type === 'group-match:leave') {
      removeFromQueue(socket)
      return
    }

    if (message.type === WS_MESSAGE_TYPE.signal) {
      const partner = getPartner(socket)
      if (partner && message.payload) {
        send(partner, { type: WS_MESSAGE_TYPE.signal, payload: message.payload })
        inc(METRIC_NAMES.signalsRelayed)
      } else {
        const group = getGroupRoom(socket)
        if (group && message.payload) {
          const msgAsAny = message as unknown as { targetUserId?: number }
          const targetId = msgAsAny.targetUserId
          let relayed = false
          if (targetId) {
            for (const [sock, p] of group.participants) {
              if (p.userId === targetId && sock !== socket) {
                send(sock, { type: WS_MESSAGE_TYPE.signal, payload: message.payload, targetUserId: getMeta(socket)?.userId })
                relayed = true
                break
              }
            }
          } else {
            for (const [sock] of group.participants) {
              if (sock !== socket) {
                send(sock, { type: WS_MESSAGE_TYPE.signal, payload: message.payload, targetUserId: getMeta(socket)?.userId })
                relayed = true
              }
            }
          }
          if (relayed) inc(METRIC_NAMES.signalsRelayed)
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.chat) {
      if (!rateLimit(`wschat:${ip}`, 30, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down chat.' })
        return
      }
      const meta = getMeta(socket)
      const partner = getPartner(socket)
      const partnerId = getPartnerUserId(socket)
      const text = message.payload?.text?.slice(0, 500)
      const time = message.payload?.time || new Date().toISOString()
      if (partner && text) {
        send(partner, {
          type: WS_MESSAGE_TYPE.chat,
          payload: { text, time },
        })
        inc(METRIC_NAMES.chatsRelayed)
        if (meta?.userId && partnerId && (await hasRelationship(meta.userId, partnerId))) {
          await sendMessage(meta.userId, partnerId, text)
        }
      } else {
        const group = getGroupRoom(socket)
        if (group && text) {
          for (const [sock] of group.participants) {
            if (sock !== socket) {
              send(sock, {
                type: WS_MESSAGE_TYPE.chat,
                payload: { text, time },
              })
            }
          }
          inc(METRIC_NAMES.chatsRelayed)
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.report) {
      if (!rateLimit(`wsreport:${ip}`, 10, 60_000)) return
      if (!config.features.guestReports) {
        const meta = getMeta(socket)
        if (!meta?.userId) {
          send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to report.' })
          return
        }
      }
      const room = getRoom(socket)
      const meta = getMeta(socket)
      await db.execute({
        sql: 'INSERT INTO reports (reporter_id, reporter_session, room_id, reason, detail) VALUES (?, ?, ?, ?, ?)',
        args: [
          meta?.userId ?? null,
          sessionKey,
          room?.id ?? null,
          message.reason,
          message.detail?.slice(0, 500) ?? null,
        ],
      })
      inc(METRIC_NAMES.reportsTotal)
      void noteReport(message.reason)
      const partner = getPartner(socket)
      leaveRoom(socket, true, PEER_LEFT_REASON.reported)
      send(socket, { type: WS_MESSAGE_TYPE.reportAck })
      if (partner) leaveRoom(partner, false)
      return
    }

    if (message.type === WS_MESSAGE_TYPE.block) {
      const meta = getMeta(socket)
      const peerId = getPartnerUserId(socket)
      if (meta?.userId && peerId) {
        await db.execute({
          sql: 'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
          args: [meta.userId, peerId],
        })
        blockPair(meta.userId, peerId)
        inc(METRIC_NAMES.blocksTotal)
      }
      const partner = getPartner(socket)
      leaveRoom(socket, true, PEER_LEFT_REASON.blocked)
      send(socket, { type: WS_MESSAGE_TYPE.blockAck })
      if (partner) leaveRoom(partner, false)
      return
    }

    // Friend system WS handlers
    if (message.type === WS_MESSAGE_TYPE.friendRequest) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send friend requests.' })
        return
      }
      const targetSocket = getSocketForUser(message.userId)
      if (!targetSocket) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'User is not online.' })
        return
      }
      await sendFriendRequest(meta.userId, message.userId)
      const fromRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
      const fromProfile = fromRow.rows[0]
      send(targetSocket, { type: WS_MESSAGE_TYPE.friendRequest, friendId: meta.userId, from: fromProfile ? publicUser(fromProfile as unknown as UserRow) : { id: meta.userId, email: '' } })
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendAccept) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await respondFriendRequest(message.friendId, meta.userId, 'accept')
      const friend = await db.execute({ sql: 'SELECT user_a_id, user_b_id FROM friends WHERE id = ?', args: [message.friendId] })
      const row = friend.rows[0]
      if (row) {
        const otherId = Number(row.user_a_id) === meta.userId ? Number(row.user_b_id) : Number(row.user_a_id)
        const otherSocket = getSocketForUser(otherId)
        if (otherSocket) {
          const otherRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [otherId] })
          const otherProfile = otherRow.rows[0]
          send(otherSocket, { type: WS_MESSAGE_TYPE.friendAccepted, friendId: message.friendId, from: otherProfile ? publicUser(otherProfile as unknown as UserRow) : { id: otherId, email: '' } })
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendDecline) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await respondFriendRequest(message.friendId, meta.userId, 'decline')
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendRemove) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await removeFriend(message.friendId, meta.userId)
      return
    }

    // Follow system WS handlers
    if (message.type === WS_MESSAGE_TYPE.follow) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to follow.' })
        return
      }
      await followUser(meta.userId, message.userId)
      const targetSocket = getSocketForUser(message.userId)
      if (targetSocket) {
        const followedRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
        const followedProfile = followedRow.rows[0]
        send(targetSocket, { type: WS_MESSAGE_TYPE.followConfirm, followed: followedProfile ? publicUser(followedProfile as unknown as UserRow) : { id: meta.userId, email: '' } })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.unfollow) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await unfollowUser(meta.userId, message.userId)
      return
    }

    // Invitation system WS handlers
    if (message.type === WS_MESSAGE_TYPE.invitationSend) {
      const meta = getMeta(socket)
      console.debug('[ws] invitation:send', { from: meta?.userId, to: message.userId, roomId: message.roomId })
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send invitations.' })
        return
      }
      const { invitationId } = await sendInvitation(meta.userId, message.userId, message.roomId)
      const targetSocket = getSocketForUser(message.userId)
      console.debug('[ws] invitation:send target', { targetOnline: !!targetSocket, targetUserId: message.userId, invitationId })
      if (targetSocket) {
        const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
        const inviterProfile = inviterRow.rows[0]
        send(targetSocket, { type: WS_MESSAGE_TYPE.invitationSend, invitationId, roomId: message.roomId, inviter: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: meta.userId, email: '' } })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.invitationAccept) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      const invitation = await db.execute({ sql: 'SELECT inviter_id, room_id FROM invitations WHERE id = ?', args: [message.invitationId] })
      const row = invitation.rows[0] as unknown as { inviter_id: number; room_id: string } | undefined
      await respondInvitation(message.invitationId, meta.userId, 'accept')
      if (row) {
        await matchUsers(row.inviter_id, meta.userId)
        const inviterSocket = getSocketForUser(row.inviter_id)
        if (inviterSocket) {
          send(inviterSocket, { type: WS_MESSAGE_TYPE.invitationAccepted, invitationId: message.invitationId, roomId: row.room_id })
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.invitationDecline) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      const invitation = await db.execute({ sql: 'SELECT inviter_id FROM invitations WHERE id = ?', args: [message.invitationId] })
      const row = invitation.rows[0] as unknown as { inviter_id: number } | undefined
      await respondInvitation(message.invitationId, meta.userId, 'decline')
      if (row) {
        const inviterSocket = getSocketForUser(row.inviter_id)
        if (inviterSocket) {
          send(inviterSocket, { type: WS_MESSAGE_TYPE.invitationDeclined, invitationId: message.invitationId })
        }
      }
      return
    }

    // Messages WS handlers
    if (message.type === WS_MESSAGE_TYPE.messageSend) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send messages.' })
        return
      }
      if (!rateLimit(`wsmsg:${meta.userId}`, 30, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down messages.' })
        return
      }
      const friendId = Number(message.friendId)
      const text = String(message.text ?? '').slice(0, 500)
      if (!friendId || !text) return
      if (!(await hasRelationship(meta.userId, friendId))) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'No relationship.' })
        return
      }
      const msg = await sendMessage(meta.userId, friendId, text)
      if (friendId !== meta.userId) {
        const targetSocket = getSocketForUser(friendId)
        if (targetSocket) {
          send(targetSocket, { type: WS_MESSAGE_TYPE.messageNew, message: msg })
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.messageHistory) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      const friendId = Number(message.friendId)
      if (!friendId) return
      if (!(await hasRelationship(meta.userId, friendId))) return
      const limit = Math.min(Number(message.limit) || 50, 100)
      const beforeId = message.beforeId ? Number(message.beforeId) : undefined
      const messages = await getConversation(meta.userId, friendId, limit, beforeId)
      send(socket, { type: WS_MESSAGE_TYPE.messageHistory, friendId, messages })
      return
    }

    if (message.type === WS_MESSAGE_TYPE.groupMessageSend) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      const { groupId, text } = message as { groupId: number; text: string }
      if (!groupId || !text?.trim()) return
      const sentMessage = await sendGroupMessage(groupId, meta.userId, text)
      const members = await getGroupMembers(groupId)
      for (const member of members) {
        const targetSocket = getSocketForUser(member.userId)
        if (targetSocket) {
          send(targetSocket, { type: WS_MESSAGE_TYPE.groupMessageNew, message: sentMessage })
        }
      }
      return
    }

    // Group invite WS handlers
    if (message.type === WS_MESSAGE_TYPE.groupInviteSend) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to invite.' })
        return
      }
      if (!rateLimit(`wsginvite:${meta.userId}`, 10, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down invites.' })
        return
      }
      try {
        const invite = await sendGroupInvite(message.groupId, meta.userId, message.userId)
        const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
        const inviterProfile = inviterRow.rows[0]
        const targetSocket = getSocketForUser(message.userId)
        if (targetSocket) {
          send(targetSocket, {
            type: 'group:invite',
            inviteId: invite.id,
            groupId: invite.groupId,
            groupName: invite.groupName,
            inviter: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: meta.userId, email: '' },
          })
        }
      } catch (err) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: err instanceof Error ? err.message : 'Invite failed.' })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.groupInviteAccept) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      try {
        const result = await respondGroupInvite(message.inviteId, meta.userId, 'accept')
        const invite = await getGroupInvite(message.inviteId)
        if (invite) {
          const accepterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
          const accepterProfile = accepterRow.rows[0]
          const inviterSocket = getSocketForUser(result.inviterId)
          if (inviterSocket) {
            send(inviterSocket, {
              type: 'group:invite:accepted',
              inviteId: message.inviteId,
              groupId: result.groupId,
              userId: meta.userId,
            })
          }
        }
      } catch {
        /* ignore */
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.groupInviteDecline) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      try {
        const result = await respondGroupInvite(message.inviteId, meta.userId, 'decline')
        const declinerRow = await db.execute({ sql: 'SELECT id, email FROM users WHERE id = ?', args: [meta.userId] })
        const declinerProfile = declinerRow.rows[0]
        const inviterSocket = getSocketForUser(result.inviterId)
        if (inviterSocket) {
          send(inviterSocket, {
            type: 'group:invite:declined',
            inviteId: message.inviteId,
            groupId: result.groupId,
            userId: meta.userId,
          })
        }
      } catch {
        /* ignore */
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.telemetryQuality) {
      if (!config.features.qualityTelemetry) return
      if (!rateLimit(`telemetry:${ip}`, 60, 60_000)) return
      inc(METRIC_NAMES.webrtcQuality(message.quality))
      logger.debug('webrtc.quality', {
        roomId: message.roomId,
        quality: message.quality,
        ice: message.iceState,
        conn: message.connectionState,
      })
    }

    if (message.type === WS_MESSAGE_TYPE.telemetryQuality) {
      if (!config.features.qualityTelemetry) return
      if (!rateLimit(`telemetry:${ip}`, 60, 60_000)) return
      inc(METRIC_NAMES.webrtcQuality(message.quality))
      logger.debug('webrtc.quality', {
        roomId: message.roomId,
        quality: message.quality,
        ice: message.iceState,
        conn: message.connectionState,
      })
    }
  }
}

// Re-export helpers that are used inside the handler
import { isBanned } from '../auth'
import { normalizePreferences, joinQueue } from '../matchmaking'
